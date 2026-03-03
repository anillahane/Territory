const express = require('express');
const Joi = require('joi');
const { query } = require('../config/database');
const { encodePocketId, decodePocketId } = require('../utils/geometry');
const { asyncHandler, AppError } = require('../middleware/errorHandler');

const router = express.Router();

// Validation schemas
const encodeSchema = Joi.object({
  lat: Joi.number().min(-90).max(90),
  lon: Joi.number().min(-180).max(180),
  latitude: Joi.number().min(-90).max(90),
  longitude: Joi.number().min(-180).max(180),
}).custom((value, helpers) => {
  const hasShortPair = value.lat !== undefined || value.lon !== undefined;
  const hasLongPair =
    value.latitude !== undefined || value.longitude !== undefined;

  if (!hasShortPair && !hasLongPair) {
    return helpers.error('any.required');
  }

  if (hasShortPair && (value.lat === undefined || value.lon === undefined)) {
    return helpers.error('any.invalid');
  }

  if (
    hasLongPair &&
    (value.latitude === undefined || value.longitude === undefined)
  ) {
    return helpers.error('any.invalid');
  }

  return value;
}, 'coordinate pair validation');

const decodeSchema = Joi.object({
  pocketId: Joi.string().required(),
});

/**
 * POST /api/v1/pocket/encode
 * Encode lat/lon to Pocket ID
 */
router.post(
  '/encode',
  asyncHandler(async (req, res) => {
    // Validate request body
    const { error, value } = encodeSchema.validate(req.body);
    if (error) {
      throw new AppError(
        error.details[0].message,
        400,
        'VALIDATION_ERROR',
        error.details
      );
    }

    const lat = value.lat ?? value.latitude;
    const lon = value.lon ?? value.longitude;

    // Get current configuration
    const configResult = await query('SELECT * FROM config WHERE id = 1');
    const config = {
      originLat: configResult.rows[0].origin_lat,
      originLon: configResult.rows[0].origin_lon,
      alphabet: configResult.rows[0].alphabet,
    };

    // Encode to Pocket ID
    const result = encodePocketId(lat, lon, config);

    res.json({
      pocketId: result.pocketId,
      input: {
        lat,
        lon,
      },
      meters: {
        x: result.meters.x,
        y: result.meters.y,
      },
      indices: result.indices.map((idx) => ({
        level: idx.level,
        levelSize: idx.levelSize,
        row: idx.row,
        col: idx.col,
      })),
      breakdown: result.pocketId.split('-').map((part, i) => ({
        level: i,
        levelSize: result.indices[i].levelSize,
        code: part,
        row: result.indices[i].row,
        col: result.indices[i].col,
      })),
    });
  })
);

/**
 * POST /api/v1/pocket/decode
 * Decode Pocket ID to center coordinates
 */
router.post(
  '/decode',
  asyncHandler(async (req, res) => {
    // Validate request body
    const { error, value } = decodeSchema.validate(req.body);
    if (error) {
      throw new AppError(
        error.details[0].message,
        400,
        'VALIDATION_ERROR',
        error.details
      );
    }

    const { pocketId } = value;

    // Get current configuration
    const configResult = await query('SELECT * FROM config WHERE id = 1');
    const config = {
      originLat: configResult.rows[0].origin_lat,
      originLon: configResult.rows[0].origin_lon,
      alphabet: configResult.rows[0].alphabet,
    };

    // Decode Pocket ID
    try {
      const result = decodePocketId(pocketId, config);

      res.json({
        pocketId,
        centerLat: result.centerLat,
        centerLon: result.centerLon,
        center: {
          lat: result.centerLat,
          lon: result.centerLon,
        },
        corners: {
          sw: result.corners.sw,
          ne: result.corners.ne,
          nw: result.corners.nw,
          se: result.corners.se,
          southwest: {
            lat: result.corners.sw.lat,
            lon: result.corners.sw.lon,
          },
          northeast: {
            lat: result.corners.ne.lat,
            lon: result.corners.ne.lon,
          },
          northwest: {
            lat: result.corners.nw.lat,
            lon: result.corners.nw.lon,
          },
          southeast: {
            lat: result.corners.se.lat,
            lon: result.corners.se.lon,
          },
        },
        indices: result.indices.map((idx) => ({
          level: idx.level,
          levelSize: idx.levelSize,
          row: idx.row,
          col: idx.col,
        })),
        cellSize: result.indices[result.indices.length - 1].levelSize,
      });
    } catch (err) {
      throw new AppError(
        `Invalid Pocket ID: ${err.message}`,
        400,
        'INVALID_POCKET_ID'
      );
    }
  })
);

/**
 * POST /api/v1/pocket/validate
 * Validate a Pocket ID
 */
router.post(
  '/validate',
  asyncHandler(async (req, res) => {
    const { pocketId } = req.body;

    if (!pocketId) {
      throw new AppError('Pocket ID is required', 400, 'MISSING_POCKET_ID');
    }

    // Get current configuration
    const configResult = await query('SELECT * FROM config WHERE id = 1');
    const config = {
      originLat: configResult.rows[0].origin_lat,
      originLon: configResult.rows[0].origin_lon,
      alphabet: configResult.rows[0].alphabet,
    };

    try {
      const decoded = decodePocketId(pocketId, config);

      res.json({
        valid: true,
        pocketId,
        levels: decoded.indices.length,
      });
    } catch (err) {
      res.json({
        valid: false,
        pocketId,
        error: err.message,
      });
    }
  })
);

module.exports = router;
