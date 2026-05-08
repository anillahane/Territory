const express = require('express');
const Joi = require('joi');
const multer = require('multer');
const xlsx = require('xlsx');
const { v4: uuidv4 } = require('uuid');
const { query, transaction } = require('../config/database');
const { encodePocketId } = require('../utils/geometry');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { requireRole } = require('../middleware/auth');
const { branchUploadQueue } = require('../config/queue');
const logger = require('../config/logger');
const { validateUploadedExcelFile } = require('../utils/fileValidation');

const router = express.Router();
const BRANCH_COVERAGE_BASIS_TYPES = [
  'current_ownership',
  'closest_branch',
  'strongest_presence',
  'mutually_exclusive'
];

const getCoverageDatasetStatus = ({
  datasetRow,
  latestJobId,
  branchUpdatedAt
}) => {
  if (!datasetRow) {
    return {
      status: 'missing',
      sourceJobId: null,
      computedAt: null
    };
  }

  if (String(datasetRow.status || '') !== 'ready') {
    return {
      status: 'failed',
      sourceJobId: datasetRow.source_job_id || null,
      computedAt: datasetRow.computed_at || null
    };
  }

  const computedAt = datasetRow.computed_at ? new Date(datasetRow.computed_at) : null;
  const updatedAt = branchUpdatedAt ? new Date(branchUpdatedAt) : null;
  const isStaleForJob = latestJobId && String(datasetRow.source_job_id || '') !== String(latestJobId);
  const isStaleForBranchUpdate = (
    computedAt
    && updatedAt
    && !Number.isNaN(computedAt.getTime())
    && !Number.isNaN(updatedAt.getTime())
    && computedAt.getTime() < updatedAt.getTime()
  );

  return {
    status: (isStaleForJob || isStaleForBranchUpdate) ? 'stale' : 'ready',
    sourceJobId: datasetRow.source_job_id || null,
    computedAt: datasetRow.computed_at || null
  };
};

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
  requireRole('admin'),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new AppError('No file uploaded', 400, 'NO_FILE');
    }

    const validation = await validateUploadedExcelFile(req.file);

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
          fileName: validation.sanitizedFileName,
          rowCount: validation.rowCount,
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
      fileName: validation.sanitizedFileName,
      fileSize: req.file.size,
      uploadMode,
    });

    // Return immediately with job ID
    res.status(202).json({
      message: 'Upload queued for processing',
      jobId: job.id,
      status: 'queued',
      rowCount: validation.rowCount,
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
    const requestedBasisType = String(req.query.basisType || '').trim().toLowerCase();

    if (requestedBasisType && !BRANCH_COVERAGE_BASIS_TYPES.includes(requestedBasisType)) {
      throw new AppError(
        `Invalid basisType. Use one of: ${BRANCH_COVERAGE_BASIS_TYPES.join(', ')}`,
        400,
        'INVALID_BASIS_TYPE'
      );
    }

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

    let latestCoverageJobId = null;
    let coverageDatasetByBranchId = new Map();
    try {
      const latestCoverageJobResult = await query(
        `
          SELECT cpm.job_id
          FROM customer_pocket_mappings cpm
          JOIN jobs j ON j.job_id = cpm.job_id
          ORDER BY j.completed_at DESC NULLS LAST, cpm.created_at DESC
          LIMIT 1
        `
      );
      latestCoverageJobId = latestCoverageJobResult.rows[0]?.job_id || null;

      const branchIds = result.rows.map((row) => String(row.id || '').trim()).filter(Boolean);
      if (branchIds.length > 0) {
        const coverageResult = await query(
          `
            SELECT
              branch_id,
              basis_type,
              status,
              source_job_id,
              computed_at,
              native_customer_count,
              catchment_customer_count,
              total_customer_count,
              farthest_customer_distance_km
            FROM branch_coverage_datasets
            WHERE branch_id = ANY($1::text[])
          `,
          [branchIds]
        );

        coverageDatasetByBranchId = coverageResult.rows.reduce((accumulator, row) => {
          const branchId = String(row.branch_id || '').trim();
          const basisType = String(row.basis_type || '').trim();
          if (!branchId || !basisType) {
            return accumulator;
          }

          if (!accumulator.has(branchId)) {
            accumulator.set(branchId, new Map());
          }

          accumulator.get(branchId).set(basisType, row);
          return accumulator;
        }, new Map());
      }
    } catch (error) {
      if (!(error && (error.code === '42P01' || error.code === '42703'))) {
        throw error;
      }
    }

    res.json({
      branches: result.rows.map((row) => ({
        ...(requestedBasisType ? (() => {
          const branchCoverageRows = coverageDatasetByBranchId.get(String(row.id || '').trim()) || new Map();
          const datasetRow = branchCoverageRows.get(requestedBasisType) || null;
          const datasetStatus = getCoverageDatasetStatus({
            datasetRow,
            latestJobId: latestCoverageJobId,
            branchUpdatedAt: row.updated_at
          });

          return {
            coverageMetrics: datasetRow ? {
              basisType: requestedBasisType,
              status: datasetStatus.status,
              sourceJobId: datasetStatus.sourceJobId,
              computedAt: datasetStatus.computedAt,
              nativeCustomerCount: Number(datasetRow.native_customer_count || 0),
              catchmentCustomerCount: Number(datasetRow.catchment_customer_count || 0),
              totalCustomerCount: Number(datasetRow.total_customer_count || 0),
              farthestCustomerDistanceKm: Number(datasetRow.farthest_customer_distance_km || 0)
            } : {
              basisType: requestedBasisType,
              status: datasetStatus.status,
              sourceJobId: datasetStatus.sourceJobId,
              computedAt: datasetStatus.computedAt,
              nativeCustomerCount: 0,
              catchmentCustomerCount: 0,
              totalCustomerCount: 0,
              farthestCustomerDistanceKm: 0
            }
          };
        })() : {}),
        id: row.id,
        city: row.city,
        lat: row.lat,
        lon: row.lon,
        pocketId: row.pocket_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        coverageStatus: BRANCH_COVERAGE_BASIS_TYPES.reduce((accumulator, basisType) => {
          const branchCoverageRows = coverageDatasetByBranchId.get(String(row.id || '').trim()) || new Map();
          accumulator[basisType] = getCoverageDatasetStatus({
            datasetRow: branchCoverageRows.get(basisType) || null,
            latestJobId: latestCoverageJobId,
            branchUpdatedAt: row.updated_at
          });
          return accumulator;
        }, {}),
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
  requireRole('admin'),
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
  requireRole('admin'),
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
  requireRole('admin'),
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
