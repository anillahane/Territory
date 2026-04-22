const express = require('express');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { branchUploadQueue, batchProcessQueue } = require('../config/queue');
const logger = require('../config/logger');
const jobStatusService = require('../services/JobStatusService');

const router = express.Router();
const JOB_STREAM_REFRESH_INTERVAL_MS = 1000;
const JOB_STREAM_KEEPALIVE_INTERVAL_MS = 15000;

const findQueueJob = async (jobId) => {
  let job = await branchUploadQueue.getJob(jobId);
  if (!job) {
    job = await batchProcessQueue.getJob(jobId);
  }

  return job;
};

const writeServerSentEvent = (res, eventName, payload) => {
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
};

router.get('/stream', async (req, res, next) => {
  try {
    const { status, type, limit } = req.query;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }

    let isClosed = false;
    let lastSnapshotSignature = '';
    let snapshotInterval = null;
    let keepAliveInterval = null;

    const closeStream = () => {
      if (isClosed) {
        return;
      }

      isClosed = true;

      if (snapshotInterval) {
        clearInterval(snapshotInterval);
      }

      if (keepAliveInterval) {
        clearInterval(keepAliveInterval);
      }

      res.end();
    };

    const sendJobsSnapshot = async () => {
      const payload = await jobStatusService.listJobs({
        status,
        type,
        limit,
      });
      const snapshotSignature = JSON.stringify(payload);
      if (snapshotSignature === lastSnapshotSignature) {
        return;
      }

      lastSnapshotSignature = snapshotSignature;
      writeServerSentEvent(res, 'jobs', payload);
    };

    await sendJobsSnapshot();

    snapshotInterval = setInterval(() => {
      void sendJobsSnapshot().catch((error) => {
        logger.error('Jobs SSE stream update failed', {
          error: error.message,
        });
        closeStream();
      });
    }, JOB_STREAM_REFRESH_INTERVAL_MS);

    keepAliveInterval = setInterval(() => {
      res.write(': keep-alive\n\n');
    }, JOB_STREAM_KEEPALIVE_INTERVAL_MS);

    req.on('close', closeStream);
    req.on('aborted', closeStream);
  } catch (error) {
    next(error);
  }
});

router.get(
  '/:jobId',
  asyncHandler(async (req, res) => {
    const job = await jobStatusService.getJobStatus(req.params.jobId);
    res.json(job);
  })
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const payload = await jobStatusService.listJobs({
      status: req.query.status,
      type: req.query.type,
      limit: req.query.limit,
    });

    res.json(payload);
  })
);

router.delete(
  '/:jobId',
  asyncHandler(async (req, res) => {
    const deletedJob = await jobStatusService.deleteJob(req.params.jobId);

    logger.info('Job deleted', { jobId: deletedJob.jobId });

    res.json({
      message: 'Job deleted successfully',
      jobId: deletedJob.jobId,
    });
  })
);

router.post(
  '/bulk-delete',
  asyncHandler(async (req, res) => {
    const deletedCount = await jobStatusService.bulkDeleteJobs({
      jobIds: req.body.jobIds,
      status: req.body.status,
    });

    logger.info('Bulk delete completed', {
      deletedCount,
      status: req.body.status,
      jobIdsCount: req.body.jobIds?.length,
    });

    res.json({
      message: `${deletedCount} job(s) deleted successfully`,
      deletedCount,
    });
  })
);

router.post(
  '/:jobId/retry',
  asyncHandler(async (req, res) => {
    const { jobId } = req.params;
    const jobStatus = await jobStatusService.getJobStatus(jobId);

    if (jobStatus.status !== jobStatusService.JOB_STATUS.FAILED) {
      throw new AppError(
        'Only failed jobs can be retried',
        400,
        'INVALID_JOB_STATE'
      );
    }

    const queueJob = await findQueueJob(jobId);
    if (!queueJob) {
      throw new AppError('Job not found', 404, 'JOB_NOT_FOUND');
    }

    const queueState = await queueJob.getState();
    if (queueState !== 'failed') {
      throw new AppError(
        'Only failed jobs can be retried',
        400,
        'INVALID_JOB_STATE'
      );
    }

    await queueJob.retry();
    await jobStatusService.resetJobForRetry(jobId);

    logger.info('Job retried', { jobId });

    res.json({
      message: 'Job queued for retry',
      jobId,
    });
  })
);

module.exports = router;
