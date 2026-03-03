const express = require('express');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { branchUploadQueue, batchProcessQueue } = require('../config/queue');
const logger = require('../config/logger');

const router = express.Router();

/**
 * GET /api/v1/jobs/:jobId
 * Get job status and progress
 */
router.get(
  '/:jobId',
  asyncHandler(async (req, res) => {
    const { jobId } = req.params;

    // Try to find job in both queues
    let job = await branchUploadQueue.getJob(jobId);
    if (!job) {
      job = await batchProcessQueue.getJob(jobId);
    }

    if (!job) {
      throw new AppError('Job not found', 404, 'JOB_NOT_FOUND');
    }

    const state = await job.getState();
    const progress = job.progress();
    const reason = job.failedReason;

    let result = null;
    if (state === 'completed') {
      result = job.returnvalue;
    }

    res.json({
      jobId: job.id,
      type: job.queue.name,
      status: state, // 'waiting', 'active', 'completed', 'failed', 'delayed'
      progress: typeof progress === 'number' ? progress : 0,
      result,
      error: reason || null,
      createdAt: job.timestamp,
      processedAt: job.processedOn,
      finishedAt: job.finishedOn,
    });
  })
);

/**
 * GET /api/v1/jobs
 * List all jobs directly from PostgreSQL (Lightning Fast)
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { status, type, limit = 50 } = req.query;
    const maxLimit = Math.min(parseInt(limit, 10), 100);

    const { query } = require('../config/database');
    
    let queryText = 'SELECT * FROM jobs';
    const queryParams = [];
    const conditions = [];

    if (status) {
      conditions.push(`status = $${queryParams.length + 1}`);
      queryParams.push(status);
    }

    // Map frontend 'batch-process' to database 'batch_encode'
    if (type) {
      const dbType = type === 'batch-process' ? 'batch_encode' : type;
      conditions.push(`type = $${queryParams.length + 1}`);
      queryParams.push(dbType);
    }

    if (conditions.length > 0) {
      queryText += ' WHERE ' + conditions.join(' AND ');
    }

    queryText += ` ORDER BY created_at DESC LIMIT $${queryParams.length + 1}`;
    queryParams.push(maxLimit);

    const result = await query(queryText, queryParams);

    const formattedJobs = result.rows.map((job) => {
      // Safely parse JSONB data
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
    });

    res.json({
      jobs: formattedJobs,
      total: formattedJobs.length,
    });
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
    const { query } = require('../config/database');

    // Delete from database
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
    const { query } = require('../config/database');

    let deletedCount = 0;

    if (jobIds && Array.isArray(jobIds) && jobIds.length > 0) {
      // Delete specific job IDs
      const placeholders = jobIds.map((_, i) => `$${i + 1}`).join(',');
      const result = await query(
        `DELETE FROM jobs WHERE job_id IN (${placeholders})`,
        jobIds
      );
      deletedCount = result.rowCount || 0;
    } else if (status) {
      // Delete all jobs with specific status
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

    // Try to find job in both queues
    let job = await branchUploadQueue.getJob(jobId);
    if (!job) {
      job = await batchProcessQueue.getJob(jobId);
    }

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
