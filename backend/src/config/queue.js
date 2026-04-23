const { EventEmitter } = require('events');
const IORedis = require('ioredis');
const { Queue, Worker, QueueEvents } = require('bullmq');
const { createBullBoard } = require('@bull-board/api');
const { BullMQAdapter } = require('@bull-board/api/bullMQAdapter');
const { ExpressAdapter } = require('@bull-board/express');
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
  queue: null,
  client: {
    lpush: async () => {
      throw new Error(`Queue "${name}" is disabled`);
    },
  },
});

const redisConnection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
};

const defaultJobOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 2000,
  },
  removeOnComplete: 100,
  removeOnFail: 200,
};

const createWorkerJobProxy = (job) => Object.assign(Object.create(job), {
  progress: async (value) => job.updateProgress(value),
});

const createBullMqQueue = (name, redisClient) => {
  const queue = new Queue(name, {
    connection: redisConnection,
    defaultJobOptions,
  });
  const queueEvents = new QueueEvents(name, {
    connection: redisConnection,
  });
  const emitter = new EventEmitter();
  let worker = null;

  queueEvents.on('error', (error) => {
    emitter.emit('error', error);
  });

  return {
    name,
    queue,
    client: redisClient,
    add: async (data, options = {}) => {
      const jobOptions = { ...options };
      if (!jobOptions.jobId && data && data.jobId) {
        jobOptions.jobId = data.jobId;
      }

      return queue.add(jobOptions.name || name, data, jobOptions);
    },
    getJob: async (jobId) => queue.getJob(jobId),
    process: (concurrencyOrProcessor, maybeProcessor) => {
      if (worker) {
        return worker;
      }

      const concurrency =
        typeof concurrencyOrProcessor === 'number' ? concurrencyOrProcessor : 1;
      const processor =
        typeof concurrencyOrProcessor === 'function'
          ? concurrencyOrProcessor
          : maybeProcessor;

      if (typeof processor !== 'function') {
        throw new Error(`Queue "${name}" requires a processor function`);
      }

      worker = new Worker(
        name,
        async (job) => processor(createWorkerJobProxy(job)),
        {
          connection: redisConnection,
          concurrency,
        }
      );

      worker.on('error', (error) => {
        emitter.emit('error', error);
      });

      worker.on('failed', (job, error) => {
        emitter.emit(
          'failed',
          job || { id: undefined, data: {} },
          error || new Error('Job failed')
        );
      });

      worker.on('completed', (job, result) => {
        if (job) {
          job.returnvalue = result;
        }
        emitter.emit('completed', job || { id: undefined }, result);
      });

      return worker;
    },
    on: (eventName, handler) => {
      emitter.on(eventName, handler);
      return emitter;
    },
  };
};

let redisClient;
let branchUploadQueue;
let batchProcessQueue;
let queueAdminRouter = null;

if (queuesDisabled) {
  logger.info('Queue initialization skipped (DISABLE_QUEUES=true or NODE_ENV=test)');
  branchUploadQueue = createDisabledQueue('branch-upload');
  batchProcessQueue = createDisabledQueue('batch-process');
} else {
  redisClient = new IORedis(redisConnection);
  redisClient.on('error', (error) => {
    logger.error('Queue Redis client error', { error: error.message });
  });

  branchUploadQueue = createBullMqQueue('branch-upload', redisClient);
  batchProcessQueue = createBullMqQueue('batch-process', redisClient);

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

  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath('/admin/queues');
  createBullBoard({
    queues: [
      new BullMQAdapter(branchUploadQueue.queue),
      new BullMQAdapter(batchProcessQueue.queue),
    ],
    serverAdapter,
  });
  queueAdminRouter = serverAdapter.getRouter();
}

module.exports = {
  branchUploadQueue,
  batchProcessQueue,
  queueAdminRouter,
};
