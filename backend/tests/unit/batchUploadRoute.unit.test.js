const express = require('express');
const request = require('supertest');

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
});
