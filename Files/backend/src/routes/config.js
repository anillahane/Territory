const express = require('express');
const Joi = require('joi');
const { query } = require('../config/database');
const { validateAlphabet } = require('../utils/geometry');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const logger = require('../config/logger');

const router = express.Router();

// Validation schema
const configSchema = Joi.object({
  originLat: Joi.number().min(-90).max(90).required(),
  originLon: Joi.number().min(-180).max(180).required(),
  alphabet: Joi.string().length(30).required(),
  gridLevels: Joi.array().items(Joi.number().positive()).length(5).optional(),
});

/**
 * GET /api/v1/config
 * Retrieve current configuration
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const result = await query('SELECT * FROM config WHERE id = 1');

    if (result.rows.length === 0) {
      throw new AppError('Configuration not found', 404, 'CONFIG_NOT_FOUND');
    }

    const config = result.rows[0];

    res.json({
      id: config.id,
      originLat: config.origin_lat,
      originLon: config.origin_lon,
      alphabet: config.alphabet,
      gridLevels: config.grid_levels,
      version: config.version,
      createdAt: config.created_at,
      updatedAt: config.updated_at,
    });
  })
);

/**
 * PUT /api/v1/config
 * Update configuration
 */
router.put(
  '/',
  asyncHandler(async (req, res) => {
    // Validate request body
    const { error, value } = configSchema.validate(req.body);
    if (error) {
      throw new AppError(
        error.details[0].message,
        400,
        'VALIDATION_ERROR',
        error.details
      );
    }

    const { originLat, originLon, alphabet, gridLevels } = value;

    // Validate alphabet
    const alphabetValidation = validateAlphabet(alphabet);
    if (!alphabetValidation.valid) {
      throw new AppError(
        alphabetValidation.error,
        400,
        'INVALID_ALPHABET'
      );
    }

    // Update configuration
    const result = await query(
      `UPDATE config 
       SET origin_lat = $1, 
           origin_lon = $2, 
           alphabet = $3,
           grid_levels = $4
       WHERE id = 1
       RETURNING *`,
      [
        originLat,
        originLon,
        alphabet,
        gridLevels || [500000, 100000, 20000, 5000, 1000],
      ]
    );

    if (result.rows.length === 0) {
      throw new AppError('Configuration not found', 404, 'CONFIG_NOT_FOUND');
    }

    const config = result.rows[0];

    logger.info('Configuration updated', {
      version: config.version,
      originLat,
      originLon,
    });

    res.json({
      message: 'Configuration updated successfully',
      config: {
        id: config.id,
        originLat: config.origin_lat,
        originLon: config.origin_lon,
        alphabet: config.alphabet,
        gridLevels: config.grid_levels,
        version: config.version,
        updatedAt: config.updated_at,
      },
    });
  })
);

/**
 * GET /api/v1/config/history
 * Get configuration change history
 */
router.get(
  '/history',
  asyncHandler(async (req, res) => {
    const limit = parseInt(req.query.limit || '10', 10);
    const offset = parseInt(req.query.offset || '0', 10);

    const result = await query(
      `SELECT * FROM config_audit 
       ORDER BY changed_at DESC 
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const countResult = await query('SELECT COUNT(*) FROM config_audit');
    const total = parseInt(countResult.rows[0].count, 10);

    res.json({
      history: result.rows.map((row) => ({
        id: row.id,
        configId: row.config_id,
        originLat: row.origin_lat,
        originLon: row.origin_lon,
        alphabet: row.alphabet,
        gridLevels: row.grid_levels,
        version: row.version,
        changedAt: row.changed_at,
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

module.exports = router;
