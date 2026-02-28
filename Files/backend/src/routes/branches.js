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

    // Generate unique job ID
    const jobId = uuidv4();

    // Add job to queue
    const job = await branchUploadQueue.add(
      {
        fileBuffer: req.file.buffer,
        fileName: req.file.originalname,
      },
      {
        jobId,
      }
    );

    logger.info('Branch upload job queued', {
      jobId: job.id,
      fileName: req.file.originalname,
      fileSize: req.file.size,
    });

    // Return immediately with job ID
    res.status(202).json({
      message: 'Upload queued for processing',
      jobId: job.id,
      status: 'queued',
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
    const limit = parseInt(req.query.limit || '100', 10);
    const offset = parseInt(req.query.offset || '0', 10);
    const search = req.query.search || '';

    let queryText = `
      SELECT id, city, lat, lon, pocket_id, created_at, updated_at
      FROM branches
    `;
    const params = [];

    if (search) {
      queryText += ` WHERE id ILIKE $1 OR city ILIKE $1 OR pocket_id ILIKE $1`;
      params.push(`%${search}%`);
      queryText += ` ORDER BY id LIMIT $2 OFFSET $3`;
      params.push(limit, offset);
    } else {
      queryText += ` ORDER BY id LIMIT $1 OFFSET $2`;
      params.push(limit, offset);
    }

    const result = await query(queryText, params);

    // Get total count
    let countQuery = 'SELECT COUNT(*) FROM branches';
    const countParams = [];
    if (search) {
      countQuery += ` WHERE id ILIKE $1 OR city ILIKE $1 OR pocket_id ILIKE $1`;
      countParams.push(`%${search}%`);
    }
    const countResult = await query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].count, 10);

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
