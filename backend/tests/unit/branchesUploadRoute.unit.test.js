const express = require('express');
const request = require('supertest');
const xlsx = require('xlsx');

jest.mock('../../src/config/queue', () => ({
  branchUploadQueue: {
    add: jest.fn(),
  },
}));

jest.mock('../../src/config/database', () => ({
  query: jest.fn(),
  transaction: jest.fn(),
}));

const { errorHandler } = require('../../src/middleware/errorHandler');
const branchesRoutes = require('../../src/routes/branches');
const { branchUploadQueue } = require('../../src/config/queue');

const createWorkbookBuffer = (rows) => {
  const worksheet = xlsx.utils.json_to_sheet(rows);
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, worksheet, 'Branches');
  return xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
};

const createTestApp = () => {
  const app = express();
  app.use((req, _res, next) => {
    req.user = { id: 'test-admin', role: 'admin' };
    next();
  });
  app.use('/api/v1/branches', branchesRoutes);
  app.use(errorHandler);
  return app;
};

describe('POST /api/v1/branches/upload', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('rejects a renamed executable upload before queueing', async () => {
    const app = createTestApp();
    const disguisedExeBuffer = Buffer.from('4d5a90000300000004000000ffff0000', 'hex');

    const response = await request(app)
      .post('/api/v1/branches/upload')
      .field('uploadMode', 'overwrite')
      .attach('file', disguisedExeBuffer, {
        filename: 'malware.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      .expect(415);

    expect(response.body.code).toBe('INVALID_FILE_SIGNATURE');
    expect(branchUploadQueue.add).not.toHaveBeenCalled();
  });

  test('queues confirmWipeAll for overwrite uploads', async () => {
    const app = createTestApp();
    const workbookBuffer = createWorkbookBuffer([
      { ID: 'BR001', City: 'Mumbai', Latitude: 19.076, Longitude: 72.8777 },
    ]);

    branchUploadQueue.add.mockResolvedValue({ id: 'job-1' });

    const response = await request(app)
      .post('/api/v1/branches/upload')
      .field('uploadMode', 'overwrite')
      .field('confirmWipeAll', 'true')
      .attach('file', workbookBuffer, {
        filename: 'branches.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      .expect(202);

    expect(branchUploadQueue.add).toHaveBeenCalledWith(
      expect.objectContaining({
        uploadMode: 'overwrite',
        confirmWipeAll: true,
      }),
      expect.any(Object)
    );
    expect(response.body.confirmWipeAll).toBe(true);
  });
});
