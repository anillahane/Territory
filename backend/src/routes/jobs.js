const express = require('express');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { branchUploadQueue, batchProcessQueue } = require('../config/queue');
const { query } = require('../config/database');
const logger = require('../config/logger');

const router = express.Router();
const JOB_STREAM_REFRESH_INTERVAL_MS = 1000;
const JOB_STREAM_KEEPALIVE_INTERVAL_MS = 15000;

const parsePositiveInteger = (value, fallback) => {
  const parsedValue = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : fallback;
};

const mapRequestedJobTypeToDatabaseType = (type) =>
  type === 'batch-process' ? 'batch_encode' : type;

const formatDatabaseJob = (job) => {
  const jobData = typeof job.data === 'string' ? JSON.parse(job.data) : (job.data || {});

  return {
    jobId: job.job_id,
    type: job.type === 'batch_encode' ? 'batch-process' : job.type,
    status: job.status,
    progress: job.progress,
    createdAt: job.created_at,
    finishedAt: job.completed_at,
    data: {
      fileName: jobData.fileName || 'Unknown',
      totalAccounts: job.total || 0,
      totalPockets: jobData.totalPockets || 0,
      territoryUrl: jobData.territoryUrl || null,
      mappingsPersisted: jobData.mappingsPersisted || 0,
    },
  };
};

const findQueueJob = async (jobId) => {
  let job = await branchUploadQueue.getJob(jobId);
  if (!job) {
    job = await batchProcessQueue.getJob(jobId);
  }

  return job;
};

const buildQueueJobSnapshot = async (jobId) => {
  const job = await findQueueJob(jobId);
  if (!job) {
    return null;
  }

  const state = await job.getState();
  const progress = job.progress();
  const reason = job.failedReason;

  let result = null;
  if (state === 'completed') {
    result = job.returnvalue;
  }

  return {
    jobId: job.id,
    type: job.queue.name,
    status: state,
    progress: typeof progress === 'number' ? progress : 0,
    result,
    error: reason || null,
    createdAt: job.timestamp,
    processedAt: job.processedOn,
    finishedAt: job.finishedOn,
  };
};

const listJobsFromDatabase = async ({
  status,
  type,
  limit = 50,
  activeJobId = null,
}) => {
  const maxLimit = Math.min(parsePositiveInteger(limit, 50), 100);

  let queryText = 'SELECT * FROM jobs';
  const queryParams = [];
  const conditions = [];

  if (status) {
    conditions.push(`status = $${queryParams.length + 1}`);
    queryParams.push(status);
  }

  if (type) {
    conditions.push(`type = $${queryParams.length + 1}`);
    queryParams.push(mapRequestedJobTypeToDatabaseType(type));
  }

  if (conditions.length > 0) {
    queryText += ` WHERE ${conditions.join(' AND ')}`;
  }

  queryText += ` ORDER BY created_at DESC LIMIT $${queryParams.length + 1}`;
  queryParams.push(maxLimit);

  const result = await query(queryText, queryParams);
  const formattedJobs = result.rows.map(formatDatabaseJob);

  if (!activeJobId) {
    return {
      jobs: formattedJobs,
      total: formattedJobs.length,
    };
  }

  const liveJob = await buildQueueJobSnapshot(activeJobId);
  if (!liveJob) {
    return {
      jobs: formattedJobs,
      total: formattedJobs.length,
    };
  }

  const jobsWithLiveState = formattedJobs.map((job) =>
    job.jobId === activeJobId
      ? {
          ...job,
          status: liveJob.status,
          progress: liveJob.progress,
          finishedAt: liveJob.finishedAt || job.finishedAt,
        }
      : job
  );

  return {
    jobs: jobsWithLiveState,
    total: jobsWithLiveState.length,
  };
};

const writeServerSentEvent = (res, eventName, payload) => {
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
};

router.get('/stream', async (req, res, next) => {
  try {
    const { status, type, limit, activeJobId } = req.query;
    const normalizedActiveJobId =
      typeof activeJobId === 'string' && activeJobId.trim()
        ? activeJobId.trim()
        : null;

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
      const payload = await listJobsFromDatabase({
        status,
        type,
        limit,
        activeJobId: normalizedActiveJobId,
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
          activeJobId: normalizedActiveJobId,
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

/**
 * GET /api/v1/jobs/:jobId
 * Get job status and progress
 */
router.get(
  '/:jobId',
  asyncHandler(async (req, res) => {
    const { jobId } = req.params;
    const snapshot = await buildQueueJobSnapshot(jobId);

    if (!snapshot) {
      throw new AppError('Job not found', 404, 'JOB_NOT_FOUND');
    }

    res.json(snapshot);
  })
);

/**
 * GET /api/v1/jobs
 * List all jobs directly from PostgreSQL (Lightning Fast)
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { status, type, limit = 50, activeJobId } = req.query;
    const payload = await listJobsFromDatabase({
      status,
      type,
      limit,
      activeJobId,
    });

    res.json(payload);
  })
);

/**
 * DELETE /api/v1/jobs/:jobId
 * Cancel or remove a job
 */
router.delete(
  '/:jobId',
  asyncHandler(async (req, res) => {
    const { jobId } = req.params;

    const result = await query('DELETE FROM jobs WHERE job_id = $1 RETURNING *', [jobId]);

    if (result.rows.length === 0) {
      throw new AppError('Job not found', 404, 'JOB_NOT_FOUND');
    }

    logger.info('Job deleted', { jobId });

    res.json({
      message: 'Job deleted successfully',
      jobId,
    });
  })
);

/**
 * POST /api/v1/jobs/bulk-delete
 * Delete multiple jobs at once
 */
router.post(
  '/bulk-delete',
  asyncHandler(async (req, res) => {
    const { jobIds, status } = req.body;

    let deletedCount = 0;

    if (jobIds && Array.isArray(jobIds) && jobIds.length > 0) {
      const placeholders = jobIds.map((_, index) => `$${index + 1}`).join(',');
      const result = await query(
        `DELETE FROM jobs WHERE job_id IN (${placeholders})`,
        jobIds
      );
      deletedCount = result.rowCount || 0;
    } else if (status) {
      const result = await query('DELETE FROM jobs WHERE status = $1', [status]);
      deletedCount = result.rowCount || 0;
    } else {
      throw new AppError('Must provide either jobIds array or status', 400, 'INVALID_REQUEST');
    }

    logger.info('Bulk delete completed', { deletedCount, status, jobIdsCount: jobIds?.length });

    res.json({
      message: `${deletedCount} job(s) deleted successfully`,
      deletedCount,
    });
  })
);

/**
 * POST /api/v1/jobs/:jobId/retry
 * Retry a failed job
 */
router.post(
  '/:jobId/retry',
  asyncHandler(async (req, res) => {
    const { jobId } = req.params;
    const job = await findQueueJob(jobId);

    if (!job) {
      throw new AppError('Job not found', 404, 'JOB_NOT_FOUND');
    }

    const state = await job.getState();

    if (state !== 'failed') {
      throw new AppError(
        'Only failed jobs can be retried',
        400,
        'INVALID_JOB_STATE'
      );
    }

    await job.retry();

    logger.info('Job retried', { jobId });

    res.json({
      message: 'Job queued for retry',
      jobId,
    });
  })
);

module.exports = router;
