const Queue = require('bull');
const logger = require('./logger');

const queuesDisabled = process.env.DISABLE_QUEUES === 'true' || process.env.NODE_ENV === 'test';

const createDisabledQueue = (name) => ({
  name,
  add: async () => {
    throw new Error(`Queue "${name}" is disabled`);
  },
  getJob: async () => null,
  process: () => undefined,
  on: () => undefined,
  client: {
    lpush: async () => {
      throw new Error(`Queue "${name}" is disabled`);
    },
  },
});

// Redis connection configuration
const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
};

let branchUploadQueue;
let batchProcessQueue;

if (queuesDisabled) {
  logger.info('Queue initialization skipped (DISABLE_QUEUES=true or NODE_ENV=test)');
  branchUploadQueue = createDisabledQueue('branch-upload');
  batchProcessQueue = createDisabledQueue('batch-process');
} else {
  // Create queues
  branchUploadQueue = new Queue('branch-upload', {
    redis: redisConfig,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      removeOnComplete: 100, // Keep last 100 completed jobs
      removeOnFail: 200, // Keep last 200 failed jobs
    },
  });

  batchProcessQueue = new Queue('batch-process', {
    redis: redisConfig,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      removeOnComplete: 100,
      removeOnFail: 200,
    },
  });

  // Queue event handlers
  branchUploadQueue.on('error', (error) => {
    logger.error('Branch upload queue error', { error: error.message });
  });

  branchUploadQueue.on('failed', (job, error) => {
    logger.error('Branch upload job failed', {
      jobId: job.id,
      error: error.message,
    });
  });

  branchUploadQueue.on('completed', (job) => {
    logger.info('Branch upload job completed', {
      jobId: job.id,
      result: job.returnvalue,
    });
  });

  batchProcessQueue.on('error', (error) => {
    logger.error('Batch process queue error', { error: error.message });
  });

  batchProcessQueue.on('failed', (job, error) => {
    logger.error('Batch process job failed', {
      jobId: job.id,
      error: error.message,
    });
  });

  batchProcessQueue.on('completed', (job) => {
    logger.info('Batch process job completed', {
      jobId: job.id,
    });
  });
}

module.exports = {
  branchUploadQueue,
  batchProcessQueue,
};
