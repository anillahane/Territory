const { query } = require('../config/database');
const { AppError } = require('../middleware/errorHandler');

const JOB_STATUS = Object.freeze({
  PENDING: 'pending',
  ACTIVE: 'active',
  COMPLETED: 'completed',
  FAILED: 'failed',
});

const DATABASE_TYPE_TO_API_TYPE = Object.freeze({
  batch_encode: 'batch-process',
  branch_upload: 'branch-upload',
});

const API_TYPE_TO_DATABASE_TYPE = Object.freeze({
  'batch-process': 'batch_encode',
  'branch-upload': 'branch_upload',
});

const parsePositiveInteger = (value, fallback) => {
  const parsedValue = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : fallback;
};

const parseJobData = (rawData) => (typeof rawData === 'string' ? JSON.parse(rawData) : (rawData || {}));

const mapDatabaseJobTypeToApiType = (type) => DATABASE_TYPE_TO_API_TYPE[type] || type;

const mapRequestedJobTypeToDatabaseType = (type) => API_TYPE_TO_DATABASE_TYPE[type] || type;

const formatJobRecord = (job) => {
  const jobData = parseJobData(job.data);

  return {
    jobId: job.job_id,
    type: mapDatabaseJobTypeToApiType(job.type),
    status: job.status,
    progress: Number(job.progress || 0),
    total: Number(job.total || 0),
    resultUrl: job.result_url,
    error: job.error,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
    finishedAt: job.completed_at,
    completedAt: job.completed_at,
    data: {
      ...jobData,
      fileName: jobData.fileName || 'Unknown',
      totalAccounts: jobData.totalAccounts ?? job.total ?? 0,
      totalPockets: jobData.totalPockets ?? 0,
      territoryUrl: jobData.territoryUrl ?? null,
      mappingsPersisted: jobData.mappingsPersisted ?? 0,
    },
    result: jobData.result || null,
  };
};

const getJobRecordOrThrow = async (jobId) => {
  const result = await query('SELECT * FROM jobs WHERE job_id = $1', [jobId]);
  if (result.rows.length === 0) {
    throw new AppError('Job not found', 404, 'JOB_NOT_FOUND');
  }

  return result.rows[0];
};

const createJob = async ({ jobId, type, total = 0, data = {} }) => {
  await query(
    `INSERT INTO jobs (job_id, type, status, progress, total, data)
     VALUES ($1, $2, $3, 0, $4, $5)`,
    [jobId, type, JOB_STATUS.PENDING, total, JSON.stringify(data)]
  );
};

const patchJob = async (jobId, updates = {}) => {
  const setClauses = [];
  const params = [];
  let currentJob = null;

  const ensureCurrentJob = async () => {
    if (!currentJob) {
      currentJob = await getJobRecordOrThrow(jobId);
    }

    return currentJob;
  };

  if (updates.status !== undefined) {
    setClauses.push(`status = $${params.length + 1}`);
    params.push(updates.status);
  }

  if (updates.progress !== undefined) {
    setClauses.push(`progress = $${params.length + 1}`);
    params.push(updates.progress);
  }

  if (updates.total !== undefined) {
    setClauses.push(`total = $${params.length + 1}`);
    params.push(updates.total);
  }

  if (updates.resultUrl !== undefined) {
    setClauses.push(`result_url = $${params.length + 1}`);
    params.push(updates.resultUrl);
  }

  if (updates.error !== undefined) {
    setClauses.push(`error = $${params.length + 1}`);
    params.push(updates.error);
  }

  if (updates.data !== undefined) {
    const existingJob = await ensureCurrentJob();
    const mergedData = {
      ...parseJobData(existingJob.data),
      ...updates.data,
    };
    setClauses.push(`data = $${params.length + 1}`);
    params.push(JSON.stringify(mergedData));
  }

  if (updates.completedAt === true) {
    setClauses.push('completed_at = CURRENT_TIMESTAMP');
  } else if (updates.completedAt === null) {
    setClauses.push('completed_at = NULL');
  }

  if (setClauses.length === 0) {
    return formatJobRecord(await getJobRecordOrThrow(jobId));
  }

  setClauses.push('updated_at = CURRENT_TIMESTAMP');

  const result = await query(
    `UPDATE jobs
     SET ${setClauses.join(', ')}
     WHERE job_id = $${params.length + 1}
     RETURNING *`,
    [...params, jobId]
  );

  if (result.rows.length === 0) {
    throw new AppError('Job not found', 404, 'JOB_NOT_FOUND');
  }

  return formatJobRecord(result.rows[0]);
};

const markJobActive = async (jobId, { progress = 0, total, data } = {}) =>
  patchJob(jobId, {
    status: JOB_STATUS.ACTIVE,
    progress,
    total,
    data,
    error: null,
  });

const updateJobProgress = async (jobId, { progress, total, data } = {}) =>
  patchJob(jobId, {
    status: JOB_STATUS.ACTIVE,
    progress,
    total,
    data,
  });

const markJobCompleted = async (jobId, { resultUrl, total, data } = {}) =>
  patchJob(jobId, {
    status: JOB_STATUS.COMPLETED,
    progress: 100,
    total,
    resultUrl,
    data,
    error: null,
    completedAt: true,
  });

const markJobFailed = async (jobId, errorMessage, { data } = {}) =>
  patchJob(jobId, {
    status: JOB_STATUS.FAILED,
    error: errorMessage,
    data,
  });

const resetJobForRetry = async (jobId) =>
  patchJob(jobId, {
    status: JOB_STATUS.PENDING,
    progress: 0,
    error: null,
    completedAt: null,
  });

const getJobStatus = async (jobId) => formatJobRecord(await getJobRecordOrThrow(jobId));

const listJobs = async ({ status, type, limit = 50 } = {}) => {
  const queryParams = [];
  const conditions = [];
  const maxLimit = Math.min(parsePositiveInteger(limit, 50), 100);

  if (status) {
    conditions.push(`status = $${queryParams.length + 1}`);
    queryParams.push(status);
  }

  if (type) {
    conditions.push(`type = $${queryParams.length + 1}`);
    queryParams.push(mapRequestedJobTypeToDatabaseType(type));
  }

  let queryText = 'SELECT * FROM jobs';
  if (conditions.length > 0) {
    queryText += ` WHERE ${conditions.join(' AND ')}`;
  }

  queryText += ` ORDER BY created_at DESC LIMIT $${queryParams.length + 1}`;
  queryParams.push(maxLimit);

  const result = await query(queryText, queryParams);
  const jobs = result.rows.map(formatJobRecord);

  return {
    jobs,
    total: jobs.length,
  };
};

const deleteJob = async (jobId) => {
  const result = await query('DELETE FROM jobs WHERE job_id = $1 RETURNING *', [jobId]);
  if (result.rows.length === 0) {
    throw new AppError('Job not found', 404, 'JOB_NOT_FOUND');
  }

  return formatJobRecord(result.rows[0]);
};

const bulkDeleteJobs = async ({ jobIds, status }) => {
  if (jobIds && Array.isArray(jobIds) && jobIds.length > 0) {
    const placeholders = jobIds.map((_, index) => `$${index + 1}`).join(',');
    const result = await query(`DELETE FROM jobs WHERE job_id IN (${placeholders})`, jobIds);
    return result.rowCount || 0;
  }

  if (status) {
    const result = await query('DELETE FROM jobs WHERE status = $1', [status]);
    return result.rowCount || 0;
  }

  throw new AppError('Must provide either jobIds array or status', 400, 'INVALID_REQUEST');
};

module.exports = {
  JOB_STATUS,
  createJob,
  getJobRecordOrThrow,
  getJobStatus,
  listJobs,
  markJobActive,
  updateJobProgress,
  markJobCompleted,
  markJobFailed,
  resetJobForRetry,
  deleteJob,
  bulkDeleteJobs,
};
