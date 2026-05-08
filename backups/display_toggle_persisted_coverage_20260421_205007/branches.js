const express = require('express');
const Joi = require('joi');
const multer = require('multer');
const xlsx = require('xlsx');
const { v4: uuidv4 } = require('uuid');
const { query, transaction } = require('../config/database');
const { encodePocketId } = require('../utils/geometry');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { branchUploadQueue } = require('../config/queue');
const logger = require('../config/logger');

const router = express.Router();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE_MB || '10', 10) * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    if (
      file.mimetype ===
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.mimetype === 'application/vnd.ms-excel'
    ) {
      cb(null, true);
    } else {
      cb(new AppError('Only Excel files are allowed', 400, 'INVALID_FILE_TYPE'));
    }
  },
});

// Validation schemas
const branchSchema = Joi.object({
  id: Joi.string().max(20).required(),
  city: Joi.string().max(100).allow('', null),
  lat: Joi.number().min(-90).max(90).required(),
  lon: Joi.number().min(-180).max(180).required(),
});

/**
 * POST /api/v1/branches/upload
 * Upload Excel file with branch data (async with job queue)
 * NOTE: This must come BEFORE /:id route to avoid route conflicts
 */
router.post(
  '/upload',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new AppError('No file uploaded', 400, 'NO_FILE');
    }

    const uploadModeRaw = String(req.body?.uploadMode || 'overwrite')
      .trim()
      .toLowerCase();
    if (!['overwrite', 'add'].includes(uploadModeRaw)) {
      throw new AppError(
        'Invalid upload mode. Use "overwrite" or "add".',
        400,
        'INVALID_UPLOAD_MODE'
      );
    }
    const uploadMode = uploadModeRaw;

    // Generate unique job ID
    const jobId = uuidv4();

    let job;
    try {
      // Add job to queue
      job = await branchUploadQueue.add(
        {
          fileBuffer: req.file.buffer,
          fileName: req.file.originalname,
          uploadMode,
        },
        {
          jobId,
        }
      );
    } catch (error) {
      logger.error('Failed to queue branch upload job', {
        error: error.message,
        fileName: req.file.originalname,
      });
      throw new AppError(
        'Upload queue is unavailable. Verify Redis service is running and try again.',
        503,
        'QUEUE_UNAVAILABLE'
      );
    }

    logger.info('Branch upload job queued', {
      jobId: job.id,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      uploadMode,
    });

    // Return immediately with job ID
    res.status(202).json({
      message: 'Upload queued for processing',
      jobId: job.id,
      status: 'queued',
      uploadMode,
      statusUrl: `/api/v1/jobs/${job.id}`,
    });
  })
);

/**
 * GET /api/v1/branches/export
 * Export branches to Excel
 * NOTE: This must come BEFORE /:id route to avoid route conflicts
 */
router.get(
  '/export',
  asyncHandler(async (req, res) => {
    const result = await query(
      'SELECT id, city, lat, lon, pocket_id FROM branches ORDER BY id'
    );

    // Create workbook
    const data = result.rows.map((row) => ({
      'Branch ID': row.id,
      City: row.city,
      Latitude: row.lat,
      Longitude: row.lon,
      'Pocket ID': row.pocket_id,
    }));

    const worksheet = xlsx.utils.json_to_sheet(data);
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Branches');

    // Generate buffer
    const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=branches_${Date.now()}.xlsx`
    );
    res.send(buffer);
  })
);

/**
 * GET /api/v1/branches
 * List all branches with optional filters
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const parsedLimit = Number.parseInt(req.query.limit || '100', 10);
    const parsedOffset = Number.parseInt(req.query.offset || '0', 10);
    const limit = Number.isFinite(parsedLimit) ? Math.min(500, Math.max(1, parsedLimit)) : 100;
    const offset = Number.isFinite(parsedOffset) ? Math.max(0, parsedOffset) : 0;
    const search = String(req.query.search || '').trim();

    const bboxRaw = String(req.query.bbox || '').trim();
    let bboxFilter = null;
    if (bboxRaw) {
      const parts = bboxRaw.split(',').map((value) => Number(value.trim()));
      if (
        parts.length !== 4
        || !parts.every((value) => Number.isFinite(value))
      ) {
        throw new AppError(
          'Invalid bbox. Use "west,south,east,north" with numeric values.',
          400,
          'INVALID_BBOX'
        );
      }

      const [west, south, east, north] = parts;
      if (west < -180 || east > 180 || south < -90 || north > 90 || west >= east || south >= north) {
        throw new AppError(
          'Invalid bbox bounds. Ensure longitude is within [-180, 180], latitude within [-90, 90], and west<east, south<north.',
          400,
          'INVALID_BBOX_BOUNDS'
        );
      }

      bboxFilter = { west, south, east, north };
    }

    const whereClauses = [];
    const baseParams = [];

    if (search) {
      baseParams.push(`%${search}%`);
      whereClauses.push(`(id ILIKE $${baseParams.length} OR city ILIKE $${baseParams.length} OR pocket_id ILIKE $${baseParams.length})`);
    }

    if (bboxFilter) {
      baseParams.push(bboxFilter.west, bboxFilter.east, bboxFilter.south, bboxFilter.north);
      const westIndex = baseParams.length - 3;
      const eastIndex = baseParams.length - 2;
      const southIndex = baseParams.length - 1;
      const northIndex = baseParams.length;
      whereClauses.push(`(lon BETWEEN $${westIndex} AND $${eastIndex} AND lat BETWEEN $${southIndex} AND $${northIndex})`);
    }

    const whereSql = whereClauses.length > 0 ? ` WHERE ${whereClauses.join(' AND ')}` : '';

    const dataParams = [...baseParams, limit, offset];
    const limitIndex = dataParams.length - 1;
    const offsetIndex = dataParams.length;
    const queryText = `
      SELECT id, city, lat, lon, pocket_id, created_at, updated_at
      FROM branches
      ${whereSql}
      ORDER BY id
      LIMIT $${limitIndex} OFFSET $${offsetIndex}
    `;
    const result = await query(queryText, dataParams);

    // Get total count
    const countQuery = `
      SELECT COUNT(*)::int AS total
      FROM branches
      ${whereSql}
    `;
    const countResult = await query(countQuery, baseParams);
    const total = Number.parseInt(String(countResult.rows[0].total || '0'), 10);

    res.json({
      branches: result.rows.map((row) => ({
        id: row.id,
        city: row.city,
        lat: row.lat,
        lon: row.lon,
        pocketId: row.pocket_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    });
  })
);

/**
 * GET /api/v1/branches/:id
 * Get a single branch by ID
 */
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const result = await query(
      'SELECT * FROM branches WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      throw new AppError('Branch not found', 404, 'BRANCH_NOT_FOUND');
    }

    const branch = result.rows[0];

    res.json({
      id: branch.id,
      city: branch.city,
      lat: branch.lat,
      lon: branch.lon,
      pocketId: branch.pocket_id,
      createdAt: branch.created_at,
      updatedAt: branch.updated_at,
    });
  })
);

/**
 * POST /api/v1/branches
 * Create a new branch
 */
router.post(
  '/',
  asyncHandler(async (req, res) => {
    // Validate request body
    const { error, value } = branchSchema.validate(req.body);
    if (error) {
      throw new AppError(
        error.details[0].message,
        400,
        'VALIDATION_ERROR',
        error.details
      );
    }

    const { id, city, lat, lon } = value;

    // Get current configuration
    const configResult = await query('SELECT * FROM config WHERE id = 1');
    const config = {
      originLat: configResult.rows[0].origin_lat,
      originLon: configResult.rows[0].origin_lon,
      alphabet: configResult.rows[0].alphabet,
    };

    // Calculate Pocket ID
    const { pocketId } = encodePocketId(lat, lon, config);

    // Insert branch
    try {
      const result = await query(
        `INSERT INTO branches (id, city, lat, lon, pocket_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [id, city, lat, lon, pocketId]
      );

      const branch = result.rows[0];

      logger.info('Branch created', { id, pocketId });

      res.status(201).json({
        message: 'Branch created successfully',
        branch: {
          id: branch.id,
          city: branch.city,
          lat: branch.lat,
          lon: branch.lon,
          pocketId: branch.pocket_id,
          createdAt: branch.created_at,
        },
      });
    } catch (err) {
      if (err.code === '23505') {
        // Unique violation
        throw new AppError(
          'Branch with this ID already exists',
          409,
          'DUPLICATE_BRANCH'
        );
      }
      throw err;
    }
  })
);

/**
 * PUT /api/v1/branches/:id
 * Update a branch
 */
router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    // Validate request body
    const schema = Joi.object({
      city: Joi.string().max(100).allow('', null),
      lat: Joi.number().min(-90).max(90).required(),
      lon: Joi.number().min(-180).max(180).required(),
    });

    const { error, value } = schema.validate(req.body);
    if (error) {
      throw new AppError(
        error.details[0].message,
        400,
        'VALIDATION_ERROR',
        error.details
      );
    }

    const { city, lat, lon } = value;

    // Get current configuration
    const configResult = await query('SELECT * FROM config WHERE id = 1');
    const config = {
      originLat: configResult.rows[0].origin_lat,
      originLon: configResult.rows[0].origin_lon,
      alphabet: configResult.rows[0].alphabet,
    };

    // Calculate new Pocket ID
    const { pocketId } = encodePocketId(lat, lon, config);

    // Update branch
    const result = await query(
      `UPDATE branches 
       SET city = $1, lat = $2, lon = $3, pocket_id = $4
       WHERE id = $5
       RETURNING *`,
      [city, lat, lon, pocketId, id]
    );

    if (result.rows.length === 0) {
      throw new AppError('Branch not found', 404, 'BRANCH_NOT_FOUND');
    }

    const branch = result.rows[0];

    logger.info('Branch updated', { id, pocketId });

    res.json({
      message: 'Branch updated successfully',
      branch: {
        id: branch.id,
        city: branch.city,
        lat: branch.lat,
        lon: branch.lon,
        pocketId: branch.pocket_id,
        updatedAt: branch.updated_at,
      },
    });
  })
);

/**
 * DELETE /api/v1/branches/:id
 * Delete a branch
 */
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const result = await query('DELETE FROM branches WHERE id = $1 RETURNING id', [id]);

    if (result.rows.length === 0) {
      throw new AppError('Branch not found', 404, 'BRANCH_NOT_FOUND');
    }

    logger.info('Branch deleted', { id });

    res.json({
      message: 'Branch deleted successfully',
      id,
    });
  })
);

module.exports = router;
