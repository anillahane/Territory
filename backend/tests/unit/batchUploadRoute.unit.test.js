const express = require('express');
const request = require('supertest');
const xlsx = require('xlsx');

jest.mock('../../src/config/database', () => ({
  query: jest.fn(),
}));

jest.mock('../../src/config/queue', () => ({
  batchProcessQueue: {
    add: jest.fn(),
    client: {
      lpush: jest.fn(),
    },
    on: jest.fn(),
    process: jest.fn(),
  },
}));

jest.mock('../../src/services/MappingService', () => ({}));
jest.mock('../../src/services/BranchFinderService', () => ({}));

const { errorHandler } = require('../../src/middleware/errorHandler');
const batchRoutes = require('../../src/routes/batch');
const { query } = require('../../src/config/database');
const { batchProcessQueue } = require('../../src/config/queue');

const createWorkbookBuffer = (rows) => {
  const worksheet = xlsx.utils.json_to_sheet(rows);
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  return xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
};

const createTestApp = () => {
  const app = express();
  app.use((req, _res, next) => {
    req.user = { id: 'test-admin', role: 'admin' };
    next();
  });
  app.use('/api/v1/batch', batchRoutes);
  app.use(errorHandler);
  return app;
};

describe('POST /api/v1/batch/encode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('rejects a renamed executable upload before any DB or queue work', async () => {
    const app = createTestApp();
    const disguisedExeBuffer = Buffer.from('4d5a90000300000004000000ffff0000', 'hex');

    const response = await request(app)
      .post('/api/v1/batch/encode')
      .attach('file', disguisedExeBuffer, {
        filename: 'payload.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      .expect(415);

    expect(response.body.code).toBe('INVALID_FILE_SIGNATURE');
    expect(query).not.toHaveBeenCalled();
    expect(batchProcessQueue.add).not.toHaveBeenCalled();
    expect(batchProcessQueue.client.lpush).not.toHaveBeenCalled();
  });

  test('queues confirmWipeAll for replacement uploads', async () => {
    const app = createTestApp();
    const workbookBuffer = createWorkbookBuffer([
      { canon_lat: 12.9716, canon_long: 77.5946, lan: 'CUST001' },
    ]);

    query.mockImplementation((queryText) => {
      if (queryText.includes('SELECT * FROM config')) {
        return Promise.resolve({
          rows: [{
            origin_lat: 8,
            origin_lon: 68,
            alphabet: '0123456789ABCDEFGHJKLMNPQRSTUV',
          }],
        });
      }

      if (queryText.includes('INSERT INTO jobs')) {
        return Promise.resolve({ rowCount: 1 });
      }

      throw new Error(`Unexpected query: ${queryText}`);
    });

    batchProcessQueue.add.mockResolvedValue({ id: 'job-1' });

    const response = await request(app)
      .post('/api/v1/batch/encode')
      .field('replaceExisting', 'true')
      .field('confirmWipeAll', 'true')
      .attach('file', workbookBuffer, {
        filename: 'customers.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      .expect(202);

    expect(batchProcessQueue.add).toHaveBeenCalledWith(
      expect.objectContaining({
        replaceExisting: true,
        confirmWipeAll: true,
      })
    );
    expect(response.body.confirmWipeAll).toBe(true);
  });
});
