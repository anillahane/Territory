const xlsx = require('xlsx');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const { query } = require('../config/database');
const { findNearestPocket, haversineDistance } = require('../utils/geometry');
const { AppError } = require('../middleware/errorHandler');
const logger = require('../config/logger');
const { batchProcessQueue } = require('../config/queue');
const mappingService = require('./MappingService');
const branchFinderService = require('./BranchFinderService');
const jobStatusService = require('./JobStatusService');
const { validateUploadedWorkbook } = require('../utils/fileValidation');

const uploadDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const TARGET_POCKET_LEVEL_METERS = 5000;
const RESULT_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const withTimeout = async (promise, timeoutMs, errorMessage) => {
  let timeoutHandle;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(errorMessage));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutHandle);
  }
};

const getFirstDefinedValue = (row, aliases) => {
  for (const key of aliases) {
    if (!Object.prototype.hasOwnProperty.call(row, key)) {
      continue;
    }

    const value = row[key];
    if (value === undefined || value === null) {
      continue;
    }

    if (typeof value === 'string' && value.trim() === '') {
      continue;
    }

    return value;
  }

  return undefined;
};

const toNumber = (value) => {
  if (typeof value === 'number') {
    return value;
  }

  if (value === undefined || value === null) {
    return Number.NaN;
  }

  const normalized = String(value).replace(/,/g, '').trim();
  if (!normalized) {
    return Number.NaN;
  }

  return Number.parseFloat(normalized);
};

const parseBooleanFlag = (value, defaultValue = false) => {
  if (value === undefined || value === null) {
    return defaultValue;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();
  if (!normalized) {
    return defaultValue;
  }

  return ['1', 'true', 'yes', 'y', 'on'].includes(normalized);
};

const getScopedBranchIdsFromMappings = (mappings) =>
  Array.from(
    new Set(
      (Array.isArray(mappings) ? mappings : [])
        .map((mapping) => String(mapping?.existingBranchId || '').trim())
        .filter(Boolean)
    )
  );

const resolveReplaceExistingScope = ({
  replaceExisting = false,
  confirmWipeAll = false,
  mappings = [],
}) => {
  if (!replaceExisting) {
    return { deleteMode: 'none', branchIds: [] };
  }

  if (confirmWipeAll) {
    return { deleteMode: 'global', branchIds: [] };
  }

  const branchIds = getScopedBranchIdsFromMappings(mappings);
  if (branchIds.length === 0) {
    throw new AppError(
      'replaceExisting requires at least one valid branch_code mapped to an existing branch, or confirmWipeAll=true for a global wipe.',
      400,
      'CONFIRM_WIPE_ALL_REQUIRED'
    );
  }

  return { deleteMode: 'scoped', branchIds };
};

const removeUploadedFile = (filePath, logContext = {}) => {
  if (!filePath || !fs.existsSync(filePath)) {
    return;
  }

  try {
    fs.unlinkSync(filePath);
    logger.info('Cleaned up uploaded file', { filePath, ...logContext });
  } catch (error) {
    logger.warn('Failed to clean up uploaded file', {
      filePath,
      error: error.message,
      ...logContext,
    });
  }
};

const getCurrentConfig = async () => {
  const configResult = await query('SELECT * FROM config WHERE id = 1');
  return configResult.rows.length > 0
    ? {
        originLat: configResult.rows[0].origin_lat,
        originLon: configResult.rows[0].origin_lon,
        alphabet: configResult.rows[0].alphabet,
      }
    : {};
};

const getDownloadName = (jobId) => `pocket_ids_${jobId}.xlsx`;

const extractCompletedQueueBuffer = async (bullJob, jobId) => {
  if (!bullJob) {
    throw new AppError('Job not found in queue', 404, 'JOB_NOT_FOUND');
  }

  const state = await bullJob.getState();
  if (state !== 'completed') {
    throw new AppError(
      `Job is not completed. Current status: ${state}`,
      400,
      'JOB_NOT_READY'
    );
  }

  const result = bullJob.returnvalue;
  if (!result || !result.buffer) {
    throw new AppError('Result file not found', 404, 'FILE_NOT_FOUND');
  }

  return {
    type: 'buffer',
    buffer: Buffer.from(result.buffer, 'base64'),
    contentType: RESULT_CONTENT_TYPE,
    fileName: getDownloadName(jobId),
  };
};

const createBatchEncodeJob = async ({ file, body = {} }) => {
  if (!file) {
    throw new AppError('No file uploaded', 400, 'NO_FILE');
  }

  const { sanitizedFileName, rowCount } = await validateUploadedWorkbook(file);
  const fileName = sanitizedFileName;
  const filePath = path.join(uploadDir, `${uuidv4()}-${sanitizedFileName}`);
  await fs.promises.writeFile(filePath, file.buffer);

  const fileSizeMB = file.size / (1024 * 1024);
  const replaceExisting = parseBooleanFlag(body.replaceExisting, false);
  const confirmWipeAll = parseBooleanFlag(body.confirmWipeAll, false);
  const usePythonWorker = fileSizeMB > 0.5;
  const config = await getCurrentConfig();
  const jobId = uuidv4();

  await jobStatusService.createJob({
    jobId,
    type: 'batch_encode',
    total: 0,
    data: {
      fileName,
      rowCount,
      replaceExisting,
      confirmWipeAll,
      worker: usePythonWorker ? 'python' : 'nodejs',
    },
  });

  if (usePythonWorker) {
    logger.info('Routing to Python worker (large file)', { jobId, fileSizeMB, fileName });

    const jobPayload = {
      jobId,
      filePath,
      fileName,
      config,
      replaceExisting,
      confirmWipeAll,
    };

    try {
      await withTimeout(
        batchProcessQueue.client.lpush('python_batch_jobs', JSON.stringify(jobPayload)),
        10000,
        'Timed out while queueing Python job'
      );
      logger.info('Python job queued successfully', { jobId });
    } catch (error) {
      logger.error('Failed to queue Python job', {
        error: error.message,
        stack: error.stack,
        jobId,
      });
      removeUploadedFile(filePath, { jobId });

      await jobStatusService.markJobFailed(
        jobId,
        `Failed to queue job to Python worker: ${error.message}`
      );

      throw new AppError('Failed to queue job to Python worker', 500, 'REDIS_PUSH_ERROR');
    }

    return {
      statusCode: 200,
      payload: {
        message: 'Large file uploaded successfully. Processing with optimized Python worker.',
        jobId,
        fileName,
        rowCount,
        replaceExisting,
        confirmWipeAll,
        worker: 'python',
        statusUrl: `/api/v1/batch/status/${jobId}`,
      },
    };
  }

  logger.info('Routing to Node.js worker (small file)', { jobId, fileSizeMB, fileName });

  try {
    await withTimeout(
      batchProcessQueue.add({
        jobId,
        config,
        fileName,
        filePath,
        replaceExisting,
        confirmWipeAll,
      }),
      10000,
      'Timed out while queueing Node.js job'
    );
  } catch (error) {
    logger.error('Failed to queue Node.js job', {
      error: error.message,
      stack: error.stack,
      jobId,
    });
    removeUploadedFile(filePath, { jobId });

    await jobStatusService.markJobFailed(
      jobId,
      `Failed to queue job to Node.js worker: ${error.message}`
    );

    throw new AppError('Failed to queue job to Node.js worker', 500, 'QUEUE_PUSH_ERROR');
  }

  return {
    statusCode: 202,
    payload: {
      message: 'File uploaded successfully. Processing in background.',
      jobId,
      fileName,
      rowCount,
      replaceExisting,
      confirmWipeAll,
      worker: 'nodejs',
      statusUrl: `/api/v1/batch/status/${jobId}`,
    },
  };
};

const getBatchStatus = async (jobId) => {
  return jobStatusService.getJobStatus(jobId);
};

const getDownloadPayload = async (jobId) => {
  const jobRecord = await query('SELECT * FROM jobs WHERE job_id = $1', [jobId]);
  if (jobRecord.rows.length === 0) {
    throw new AppError('Job not found', 404, 'JOB_NOT_FOUND');
  }

  const job = jobRecord.rows[0];
  const jobData = typeof job.data === 'string' ? JSON.parse(job.data) : (job.data || {});
  const worker = jobData.worker || 'nodejs';

  if (job.status !== 'completed') {
    throw new AppError(
      `Job is not completed. Current status: ${job.status}`,
      400,
      'JOB_NOT_READY'
    );
  }

  if (worker === 'python') {
    const resultPath = path.join(uploadDir, `result_${jobId}.xlsx`);
    if (fs.existsSync(resultPath)) {
      return {
        type: 'file',
        filePath: resultPath,
        contentType: RESULT_CONTENT_TYPE,
        fileName: getDownloadName(jobId),
      };
    }

    logger.warn('Python result file not found, trying Bull queue', { jobId, resultPath });
  }

  const bullJob = await batchProcessQueue.getJob(jobId);
  return extractCompletedQueueBuffer(bullJob, jobId);
};

const processBatchQueueJob = async (job) => {
  const {
    jobId,
    data,
    config,
    fileName,
    filePath,
    replaceExisting = false,
    confirmWipeAll = false,
  } = job.data;
  let rows = data;
  let lastPersistedProgress = -1;

  const persistProgress = async (progressValue, total = rows?.length) => {
    const normalizedProgress = Math.max(0, Math.min(100, Math.floor(progressValue)));
    if (normalizedProgress === lastPersistedProgress) {
      return;
    }

    lastPersistedProgress = normalizedProgress;
    job.progress(normalizedProgress);
    await jobStatusService.updateJobProgress(jobId, {
      progress: normalizedProgress,
      total,
    });
  };

  if (!rows) {
    if (!filePath || !fs.existsSync(filePath)) {
      throw new Error('Uploaded file not found for processing');
    }

    const workbook = xlsx.read(fs.readFileSync(filePath), { type: 'buffer' });
    rows = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);

    if (rows.length === 0) {
      throw new Error('Excel file is empty');
    }
  }

  logger.info('Processing batch job (Node.js worker)', { jobId, rows: rows.length });

  const results = [];
  const errors = [];
  const pocketStats = {};
  const mappings = [];
  const pocketCenters = new Map();
  const branchLookupForExisting = new Map();

  try {
    await jobStatusService.markJobActive(jobId, {
      total: rows.length,
    });

    const branchesForExistingResult = await query('SELECT id, lat, lon FROM branches');
    branchesForExistingResult.rows.forEach((row) => {
      const id = String(row.id);
      const payload = {
        id,
        lat: Number(row.lat),
        lon: Number(row.lon),
      };
      branchLookupForExisting.set(id, payload);
      branchLookupForExisting.set(id.toUpperCase(), payload);
    });

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      try {
        await persistProgress((i / rows.length) * 100, rows.length);

        const lat = toNumber(getFirstDefinedValue(row, [
          'canon_lat',
          'CANON_LAT',
          'Canon_Lat',
          'canonLat',
          'CanonLat',
          'Latitude',
          'latitude',
          'Lat',
          'lat',
        ]));
        const lon = toNumber(getFirstDefinedValue(row, [
          'canon_long',
          'CANON_LONG',
          'Canon_Long',
          'canonLong',
          'CanonLong',
          'Longitude',
          'longitude',
          'Lon',
          'lon',
        ]));

        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
          errors.push({ row: i + 2, error: 'Invalid coordinates' });
          results.push({ ...row, PocketID: 'ERROR', Distance: 'N/A' });
          continue;
        }

        const branchCodeRaw = getFirstDefinedValue(row, [
          'branch_code',
          'BRANCH_CODE',
          'Branch_Code',
          'branchCode',
          'BranchCode',
          'Branch Code',
        ]);
        const branchCode = branchCodeRaw === undefined || branchCodeRaw === null
          ? null
          : String(branchCodeRaw).trim() || null;
        let existingBranchId = null;
        let distanceCustomerToExistingBranch = null;

        if (branchCode) {
          const matchedExistingBranch =
            branchLookupForExisting.get(branchCode) ||
            branchLookupForExisting.get(branchCode.toUpperCase());

          if (matchedExistingBranch) {
            existingBranchId = matchedExistingBranch.id;
            distanceCustomerToExistingBranch = haversineDistance(
              lat,
              lon,
              matchedExistingBranch.lat,
              matchedExistingBranch.lon
            );
          }
        }

        const nearestPocket = findNearestPocket(lat, lon, config, {
          pocketLevelMeters: TARGET_POCKET_LEVEL_METERS,
        });

        results.push({
          ...row,
          PocketID: nearestPocket.pocketId,
          'Distance to Pocket Center (m)': Math.round(nearestPocket.distance),
          'Pocket Center Lat': nearestPocket.centerLat.toFixed(6),
          'Pocket Center Lon': nearestPocket.centerLon.toFixed(6),
        });

        if (nearestPocket.pocketId !== 'ERROR') {
          pocketStats[nearestPocket.pocketId] = (pocketStats[nearestPocket.pocketId] || 0) + 1;

          if (!pocketCenters.has(nearestPocket.pocketId)) {
            pocketCenters.set(nearestPocket.pocketId, {
              lat: nearestPocket.centerLat,
              lon: nearestPocket.centerLon,
            });
          }

          const customerIdRaw = getFirstDefinedValue(row, [
            'lan',
            'LAN',
            'Lan',
            'CustomerID',
            'customer_id',
            'customerId',
            'ID',
            'id',
          ]);
          const normalizedCustomerId =
            customerIdRaw === undefined || customerIdRaw === null
              ? ''
              : String(customerIdRaw).trim();
          const customerId = normalizedCustomerId !== '' ? normalizedCustomerId : `CUST_${i + 1}`;

          mappings.push({
            customerId,
            customerLat: lat,
            customerLon: lon,
            customerBranchCode: branchCode,
            existingBranchId,
            distanceCustomerToExistingBranch,
            pocketId: nearestPocket.pocketId,
            distanceCustomerToPocket: nearestPocket.distance,
            pocketCenterLat: nearestPocket.centerLat,
            pocketCenterLon: nearestPocket.centerLon,
          });
        }
      } catch (error) {
        errors.push({ row: i + 2, error: error.message });
        results.push({ ...row, PocketID: 'ERROR', Distance: 'N/A' });
      }
    }

    const worksheet = xlsx.utils.json_to_sheet(results);
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Results');

    const statsData = Object.entries(pocketStats)
      .map(([pocketId, count]) => ({
        'Pocket ID': pocketId,
        'Account Count': count,
      }))
      .sort((a, b) => b['Account Count'] - a['Account Count']);

    const statsWorksheet = xlsx.utils.json_to_sheet(statsData);
    xlsx.utils.book_append_sheet(workbook, statsWorksheet, 'Statistics');

    const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    let mappingsPersisted = 0;
    let replacedMappingsCount = 0;
    if (mappings.length > 0) {
      try {
        logger.info('Starting mapping persistence', { jobId, mappingCount: mappings.length });

        const uniquePockets = Array.from(pocketCenters.entries()).map(([pocketId, center]) => ({
          pocketId,
          lat: center.lat,
          lon: center.lon,
        }));

        const pocketBranchMap = await branchFinderService.findNearestBranchesForPockets(uniquePockets);

        const enrichedMappings = mappings.map((mapping) => {
          const branchInfo = pocketBranchMap.get(mapping.pocketId);
          if (!branchInfo) {
            logger.warn('No branch found for pocket', { pocketId: mapping.pocketId });
            throw new Error(`No branch found for pocket ${mapping.pocketId}`);
          }

          const uploadedBranchCode = mapping.customerBranchCode
            ? String(mapping.customerBranchCode).trim()
            : null;

          return {
            customerId: mapping.customerId,
            customerLat: mapping.customerLat,
            customerLon: mapping.customerLon,
            pocketId: mapping.pocketId,
            distanceCustomerToPocket: mapping.distanceCustomerToPocket,
            nearestBranchId: branchInfo.branchId,
            distancePocketToBranch: branchInfo.distance,
            distanceCustomerToBranch: branchInfo.distance,
            uploadedBranchCode,
            existingBranchId: mapping.existingBranchId || null,
            distanceCustomerToExistingBranch:
              Number.isFinite(mapping.distanceCustomerToExistingBranch)
                ? mapping.distanceCustomerToExistingBranch
                : null,
          };
        });

        const replaceExistingScope = resolveReplaceExistingScope({
          replaceExisting,
          confirmWipeAll,
          mappings: enrichedMappings,
        });

        if (replaceExistingScope.deleteMode === 'global') {
          const deleteMappingsResult = await query('DELETE FROM customer_pocket_mappings');
          replacedMappingsCount = deleteMappingsResult.rowCount || 0;
          logger.info('Cleared all customer mappings before replacement upload', {
            jobId,
            deletedMappings: replacedMappingsCount,
            wipeScope: 'global',
          });
        } else if (replaceExistingScope.deleteMode === 'scoped') {
          const deleteMappingsResult = await query(
            `
              DELETE FROM customer_pocket_mappings
              WHERE COALESCE(existing_branch_id, nearest_branch_id) = ANY($1::text[])
            `,
            [replaceExistingScope.branchIds]
          );
          replacedMappingsCount = deleteMappingsResult.rowCount || 0;
          logger.info('Cleared scoped customer mappings before replacement upload', {
            jobId,
            deletedMappings: replacedMappingsCount,
            wipeScope: 'scoped',
            branchIds: replaceExistingScope.branchIds,
          });
        }

        const saveResult = await mappingService.saveMappings(jobId, enrichedMappings);
        mappingsPersisted = saveResult.insertedCount;

        if (!saveResult.success) {
          logger.error('Mapping persistence had errors', {
            jobId,
            insertedCount: saveResult.insertedCount,
            totalMappings: enrichedMappings.length,
            errors: saveResult.errors,
          });
        } else {
          logger.info('Mapping persistence successful', {
            jobId,
            insertedCount: saveResult.insertedCount,
          });
        }
      } catch (error) {
        logger.error('Failed to persist mappings', {
          jobId,
          error: error.message,
          stack: error.stack,
          mappingCount: mappings.length,
        });

        if (replaceExisting) {
          throw error;
        }
      }
    }

    await jobStatusService.markJobCompleted(jobId, {
      resultUrl: `/api/v1/batch/download/${jobId}`,
      total: rows.length,
      data: {
        fileName: fileName || job.data.fileName,
        pocketStats,
        totalPockets: Object.keys(pocketStats).length,
        totalAccounts: rows.length - errors.length,
        mappingsPersisted,
        replaceExisting: Boolean(replaceExisting),
        replacedMappingsCount,
        territoryUrl: `/api/v1/batch/territories/${jobId}`,
        worker: 'nodejs',
      },
    });

    logger.info('Batch job completed (Node.js worker)', {
      jobId,
      total: rows.length,
      errors: errors.length,
      uniquePockets: Object.keys(pocketStats).length,
      mappingsPersisted,
      replacedMappingsCount,
    });

    removeUploadedFile(filePath, { jobId });

    return {
      jobId,
      total: rows.length,
      errors: errors.length,
      pocketStats,
      mappingsPersisted,
      replacedMappingsCount,
      buffer: buffer.toString('base64'),
    };
  } catch (error) {
    removeUploadedFile(filePath, { jobId });
    await jobStatusService.markJobFailed(jobId, error.message);
    throw error;
  }
};

const handleBatchQueueFailure = async (job, err) => {
  logger.error('Batch job failed', { jobId: job.data.jobId, error: err.message });

  await jobStatusService.markJobFailed(job.data.jobId, err.message);
};

module.exports = {
  uploadDir,
  parseBooleanFlag,
  getScopedBranchIdsFromMappings,
  resolveReplaceExistingScope,
  createBatchEncodeJob,
  getBatchStatus,
  getDownloadPayload,
  processBatchQueueJob,
  handleBatchQueueFailure,
};
