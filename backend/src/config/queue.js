const Queue = require('bull');
const logger = require('./logger');

// Redis connection configuration
const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
};

// Create queues
const branchUploadQueue = new Queue('branch-upload', {
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

const batchProcessQueue = new Queue('batch-process', {
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

module.exports = {
  branchUploadQueue,
  batchProcessQueue,
};
