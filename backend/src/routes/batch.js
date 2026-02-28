const express = require('express');
const multer = require('multer');
const xlsx = require('xlsx');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const { query } = require('../config/database');
const { encodePocketId, findNearestPocket, haversineDistance } = require('../utils/geometry');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const logger = require('../config/logger');
const { batchProcessQueue } = require('../config/queue');
const mappingService = require('../services/MappingService');
const branchFinderService = require('../services/BranchFinderService');

const router = express.Router();

// Create a dedicated Redis client for Python worker communication
const Redis = require('ioredis');
const pythonRedisClient = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

pythonRedisClient.on('error', (error) => {
  logger.error('Python Redis client error', { error: error.message });
});

pythonRedisClient.on('connect', () => {
  logger.info('Python Redis client connected');
});

// Create uploads directory for disk storage
const uploadDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure multer with hybrid storage strategy
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, `${uuidv4()}-${file.originalname}`)
  }),
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE_MB || '50', 10) * 1024 * 1024, // Increased to 50MB
  },
});

// Threshold for switching to Python worker (rows)
const PYTHON_WORKER_THRESHOLD = parseInt(process.env.PYTHON_WORKER_THRESHOLD || '5000', 10);

// Use the shared batch process queue
const batchQueue = batchProcessQueue;

// Process jobs (Node.js worker for small files)
batchQueue.process(async (job) => {
  const { jobId, data, config, fileName, filePath } = job.data;

  logger.info('Processing batch job (Node.js worker)', { jobId, rows: data.length });

  const results = [];
  const errors = [];
  const pocketStats = {}; // Track count per pocket
  const mappings = []; // Collect mappings for persistence
  const pocketCenters = new Map(); // Cache pocket centers to avoid recalculation

  try {
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      
      try {
        // Update progress
        job.progress(Math.floor((i / data.length) * 100));

        const lat = parseFloat(row.Latitude || row.latitude || row.Lat || row.lat || row.canon_lat || row.CANON_LAT);
        const lon = parseFloat(row.Longitude || row.longitude || row.Lon || row.lon || row.canon_long || row.CANON_LONG);

        if (isNaN(lat) || isNaN(lon)) {
          errors.push({ row: i + 2, error: 'Invalid coordinates' });
          results.push({ ...row, PocketID: 'ERROR', Distance: 'N/A' });
          continue;
        }

        // Find nearest pocket based on distance to pocket center
        const nearestPocket = findNearestPocket(lat, lon, config);

        results.push({
          ...row,
          PocketID: nearestPocket.pocketId,
          'Distance to Pocket Center (m)': Math.round(nearestPocket.distance),
          'Pocket Center Lat': nearestPocket.centerLat.toFixed(6),
          'Pocket Center Lon': nearestPocket.centerLon.toFixed(6),
        });

        // Count accounts per pocket
        if (nearestPocket.pocketId !== 'ERROR') {
          pocketStats[nearestPocket.pocketId] = (pocketStats[nearestPocket.pocketId] || 0) + 1;
          
          // Cache pocket center
          if (!pocketCenters.has(nearestPocket.pocketId)) {
            pocketCenters.set(nearestPocket.pocketId, {
              lat: nearestPocket.centerLat,
              lon: nearestPocket.centerLon,
            });
          }
          
          // Extract customer ID from row (try common column names)
          const customerId = row.LAN || row.lan || row.CustomerID || row.customer_id || row.ID || row.id || `CUST_${i + 1}`;
          
          // Collect mapping data for persistence
          mappings.push({
            customerId: String(customerId),
            customerLat: lat,
            customerLon: lon,
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

    // Create Excel file
    const worksheet = xlsx.utils.json_to_sheet(results);
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Results');

    // Add statistics sheet
    const statsData = Object.entries(pocketStats)
      .map(([pocketId, count]) => ({
        'Pocket ID': pocketId,
        'Account Count': count,
      }))
      .sort((a, b) => b['Account Count'] - a['Account Count']); // Sort by count descending

    const statsWorksheet = xlsx.utils.json_to_sheet(statsData);
    xlsx.utils.book_append_sheet(workbook, statsWorksheet, 'Statistics');

    const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    // Persist mappings to database
    let mappingsPersisted = 0;
    if (mappings.length > 0) {
      try {
        logger.info('Starting mapping persistence', { jobId, mappingCount: mappings.length });
        
        // Get unique pockets and find nearest branches
        const uniquePockets = Array.from(pocketCenters.entries()).map(([pocketId, center]) => ({
          pocketId,
          lat: center.lat,
          lon: center.lon,
        }));
        
        const pocketBranchMap = await branchFinderService.findNearestBranchesForPockets(uniquePockets);
        
        // Enrich mappings with branch information
        const enrichedMappings = mappings.map(mapping => {
          const branchInfo = pocketBranchMap.get(mapping.pocketId);
          
          if (!branchInfo) {
            logger.warn('No branch found for pocket', { pocketId: mapping.pocketId });
            throw new Error(`No branch found for pocket ${mapping.pocketId}`);
          }
          
          // Calculate distance from customer to branch
          const distanceCustomerToBranch = haversineDistance(
            mapping.customerLat,
            mapping.customerLon,
            branchInfo.branchLat,
            branchInfo.branchLon
          );
          
          return {
            customerId: mapping.customerId,
            customerLat: mapping.customerLat,
            customerLon: mapping.customerLon,
            pocketId: mapping.pocketId,
            distanceCustomerToPocket: mapping.distanceCustomerToPocket,
            nearestBranchId: branchInfo.branchId,
            distancePocketToBranch: branchInfo.distance,
            distanceCustomerToBranch: distanceCustomerToBranch,
          };
        });
        
        // Get job database ID from job_id (UUID)
        const jobResult = await query('SELECT id FROM jobs WHERE job_id = $1', [jobId]);
        if (jobResult.rows.length === 0) {
          throw new Error(`Job not found in database: ${jobId}`);
        }
        const jobDatabaseId = jobResult.rows[0].id;
        
        // Save mappings
        const saveResult = await mappingService.saveMappings(jobDatabaseId, enrichedMappings);
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
        // Log error but continue processing - don't fail the batch job
        logger.error('Failed to persist mappings', {
          jobId,
          error: error.message,
          stack: error.stack,
          mappingCount: mappings.length,
        });
        // Continue with Excel export even if persistence fails
      }
    }

    // Update job in database with statistics
    await query(
      `UPDATE jobs 
       SET status = 'completed', 
           progress = 100, 
           completed_at = CURRENT_TIMESTAMP,
           result_url = $1,
           data = $2
       WHERE job_id = $3`,
      [
        `/api/v1/batch/download/${jobId}`, 
        JSON.stringify({ 
          fileName: job.data.fileName,
          pocketStats, 
          totalPockets: Object.keys(pocketStats).length,
          totalAccounts: data.length - errors.length,
          mappingsPersisted,
          worker: 'nodejs'
        }),
        jobId
      ]
    );

    logger.info('Batch job completed (Node.js worker)', { 
      jobId, 
      total: data.length, 
      errors: errors.length,
      uniquePockets: Object.keys(pocketStats).length,
      mappingsPersisted,
    });

    // Clean up uploaded file if it exists
    if (filePath && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
        logger.info('Cleaned up uploaded file', { jobId, filePath });
      } catch (err) {
        logger.warn('Failed to clean up file', { jobId, filePath, error: err.message });
      }
    }

    return {
      jobId,
      total: data.length,
      errors: errors.length,
      pocketStats,
      mappingsPersisted,
      buffer: buffer.toString('base64'),
    };
  } catch (error) {
    // Clean up file on error
    if (filePath && fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (err) {
        logger.warn('Failed to clean up file after error', { jobId, filePath });
      }
    }
    throw error;
  }
});

// Handle job failures
batchQueue.on('failed', async (job, err) => {
  logger.error('Batch job failed', { jobId: job.data.jobId, error: err.message });

  await query(
    `UPDATE jobs 
     SET status = 'failed', 
         error = $1
     WHERE job_id = $2`,
    [err.message, job.data.jobId]
  );
});

/**
 * POST /api/v1/batch/encode
 * Upload Excel file for batch Pocket ID encoding
 * HYBRID APPROACH: Small files use Node.js, large files use Python worker
 */
router.post(
  '/encode',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    console.log("1. Route hit, file uploaded to disk:", req.file?.path);
    
    if (!req.file) {
      throw new AppError('No file uploaded', 400, 'NO_FILE');
    }

    const fileName = req.file.originalname;
    const filePath = req.file.path;
    const fileSizeMB = req.file.size / (1024 * 1024);
    
    // We cannot use xlsx.read() here because large files will crash the Node.js event loop.
    // Instead, we use file size as a fast, safe proxy for the Python worker threshold.
    // 0.5 MB is approximately 5000 rows of standard location data.
    const usePythonWorker = fileSizeMB > 0.5; 

    // Get current configuration
    const configResult = await query('SELECT * FROM config WHERE id = 1');
    const config = configResult.rows.length > 0 ? {
      originLat: configResult.rows[0].origin_lat,
      originLon: configResult.rows[0].origin_lon,
      alphabet: configResult.rows[0].alphabet,
    } : {};

    const jobId = uuidv4();

    console.log("2. About to run DB insert...");
    // Create job in database (Setting total to 0, the worker will update it with exact count)
    await query(
      `INSERT INTO jobs (job_id, type, status, total, data)
       VALUES ($1, 'batch_encode', 'pending', 0, $2)`,
      [jobId, JSON.stringify({ 
        fileName,
        worker: usePythonWorker ? 'python' : 'nodejs'
      })]
    );
    console.log("3. DB insert finished. About to push to Redis...");

    if (usePythonWorker) {
      logger.info('Routing to Python worker (large file)', { jobId, fileSizeMB, fileName });

      const jobPayload = {
        jobId,
        filePath,
        fileName,
        config
      };
      
      // Use the dedicated Python Redis client (not Bull's client)
      try {
        await pythonRedisClient.lpush('python_batch_jobs', JSON.stringify(jobPayload));
        console.log("4. Raw Redis push finished.");
        logger.info('Python job queued successfully', { jobId });
      } catch (err) {
        logger.error('Failed to queue Python job', { error: err.message, jobId });
        throw new AppError('Failed to queue job to Python worker', 500, 'REDIS_PUSH_ERROR');
      }

      res.json({
        message: 'Large file uploaded successfully. Processing with optimized Python worker.',
        jobId,
        fileName,
        worker: 'python',
        statusUrl: `/api/v1/batch/status/${jobId}`,
      });
    } else {
      logger.info('Routing to Node.js worker (small file)', { jobId, fileSizeMB, fileName });

      // Only parse the file in Node if we know it's small!
      const workbook = xlsx.read(fs.readFileSync(filePath), { type: 'buffer' });
      const data = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);

      if (data.length === 0) {
        // Clean up file
        fs.unlinkSync(filePath);
        throw new AppError('Excel file is empty', 400, 'EMPTY_FILE');
      }

      await query('UPDATE jobs SET total = $1 WHERE job_id = $2', [data.length, jobId]);

      await batchQueue.add({
        jobId,
        data,
        config,
        fileName,
        filePath, 
      });

      res.json({
        message: 'File uploaded successfully. Processing in background.',
        jobId,
        fileName,
        total: data.length,
        worker: 'nodejs',
        statusUrl: `/api/v1/batch/status/${jobId}`,
      });
    }
  })
);

/**
 * GET /api/v1/batch/status/:jobId
 * Get batch job status
 */
router.get(
  '/status/:jobId',
  asyncHandler(async (req, res) => {
    const { jobId } = req.params;

    const result = await query(
      'SELECT * FROM jobs WHERE job_id = $1',
      [jobId]
    );

    if (result.rows.length === 0) {
      throw new AppError('Job not found', 404, 'JOB_NOT_FOUND');
    }

    const job = result.rows[0];

    res.json({
      jobId: job.job_id,
      type: job.type,
      status: job.status,
      progress: job.progress,
      total: job.total,
      resultUrl: job.result_url,
      error: job.error,
      createdAt: job.created_at,
      updatedAt: job.updated_at,
      completedAt: job.completed_at,
    });
  })
);

/**
 * GET /api/v1/batch/download/:jobId
 * Download batch job result
 * Handles both Node.js (in-memory) and Python (disk-based) results
 */
router.get(
  '/download/:jobId',
  asyncHandler(async (req, res) => {
    const { jobId } = req.params;

    // Check job status in database first
    const jobRecord = await query('SELECT * FROM jobs WHERE job_id = $1', [jobId]);
    
    if (jobRecord.rows.length === 0) {
      throw new AppError('Job not found', 404, 'JOB_NOT_FOUND');
    }

    const job = jobRecord.rows[0];
    // Postgres pg driver auto-parses JSONB. Only parse if it comes back as a string.
    const jobData = typeof job.data === 'string' ? JSON.parse(job.data) : (job.data || {});
    const worker = jobData.worker || 'nodejs'; // Default to nodejs for old jobs

    if (job.status !== 'completed') {
      throw new AppError(
        `Job is not completed. Current status: ${job.status}`,
        400,
        'JOB_NOT_READY'
      );
    }

    if (worker === 'python') {
      // Python worker: File saved to disk
      const resultPath = path.join(uploadDir, `result_${jobId}.xlsx`);
      
      if (!fs.existsSync(resultPath)) {
        logger.warn('Python result file not found, trying Bull queue', { jobId, resultPath });
        // Fallback to Bull queue if file doesn't exist
        const bullJob = await batchQueue.getJob(jobId);
        if (!bullJob || !bullJob.returnvalue || !bullJob.returnvalue.buffer) {
          throw new AppError('Result file not found', 404, 'FILE_NOT_FOUND');
        }
        
        const buffer = Buffer.from(bullJob.returnvalue.buffer, 'base64');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=pocket_ids_${jobId}.xlsx`);
        return res.send(buffer);
      }

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename=pocket_ids_${jobId}.xlsx`
      );
      
      // Stream file from disk
      const fileStream = fs.createReadStream(resultPath);
      fileStream.pipe(res);
    } else {
      // Node.js worker: File in Bull queue memory
      const bullJob = await batchQueue.getJob(jobId);

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

      const buffer = Buffer.from(result.buffer, 'base64');

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename=pocket_ids_${jobId}.xlsx`
      );
      res.send(buffer);
    }
  })
);

module.exports = router;
