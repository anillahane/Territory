const express = require('express');
const request = require('supertest');

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
});
