const express = require('express');
const request = require('supertest');

jest.mock('../../src/config/database', () => ({
  query: jest.fn(),
}));

jest.mock('../../src/config/queue', () => ({
  branchUploadQueue: {
    getJob: jest.fn(),
  },
  batchProcessQueue: {
    getJob: jest.fn(),
  },
}));

const { errorHandler } = require('../../src/middleware/errorHandler');
const jobsRoutes = require('../../src/routes/jobs');
const { query } = require('../../src/config/database');
const { branchUploadQueue, batchProcessQueue } = require('../../src/config/queue');

const createTestApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/jobs', jobsRoutes);
  app.use(errorHandler);
  return app;
};

describe('jobs routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('GET /api/v1/jobs/:jobId returns the database-backed job snapshot', async () => {
    query.mockResolvedValueOnce({
      rows: [{
        job_id: 'job-1',
        type: 'branch_upload',
        status: 'completed',
        progress: 100,
        total: 12,
        result_url: null,
        error: null,
        created_at: '2026-04-22T10:00:00.000Z',
        updated_at: '2026-04-22T10:05:00.000Z',
        completed_at: '2026-04-22T10:05:00.000Z',
        data: {
          fileName: 'branches.xlsx',
          result: {
            summary: {
              inserted: 12,
            },
          },
        },
      }],
    });

    const response = await request(createTestApp())
      .get('/api/v1/jobs/job-1')
      .expect(200);

    expect(response.body.jobId).toBe('job-1');
    expect(response.body.type).toBe('branch-upload');
    expect(response.body.status).toBe('completed');
    expect(response.body.data.fileName).toBe('branches.xlsx');
    expect(response.body.result.summary.inserted).toBe(12);
    expect(branchUploadQueue.getJob).not.toHaveBeenCalled();
    expect(batchProcessQueue.getJob).not.toHaveBeenCalled();
  });

  test('GET /api/v1/jobs lists jobs from the database without queue snapshots', async () => {
    query.mockResolvedValueOnce({
      rows: [{
        job_id: 'job-2',
        type: 'batch_encode',
        status: 'active',
        progress: 40,
        total: 120,
        result_url: null,
        error: null,
        created_at: '2026-04-22T11:00:00.000Z',
        updated_at: '2026-04-22T11:01:00.000Z',
        completed_at: null,
        data: {
          fileName: 'customers.xlsx',
          worker: 'nodejs',
        },
      }],
    });

    const response = await request(createTestApp())
      .get('/api/v1/jobs')
      .query({ type: 'batch-process', limit: 10 })
      .expect(200);

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('SELECT * FROM jobs'),
      ['batch_encode', 10]
    );
    expect(response.body.jobs).toHaveLength(1);
    expect(response.body.jobs[0].type).toBe('batch-process');
    expect(response.body.jobs[0].progress).toBe(40);
    expect(branchUploadQueue.getJob).not.toHaveBeenCalled();
    expect(batchProcessQueue.getJob).not.toHaveBeenCalled();
  });
});
