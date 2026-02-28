const express = require('express');
const Joi = require('joi');
const { query } = require('../config/database');
const { encodePocketId, decodePocketId } = require('../utils/geometry');
const { asyncHandler, AppError } = require('../middleware/errorHandler');

const router = express.Router();

// Validation schemas
const encodeSchema = Joi.object({
  lat: Joi.number().min(-90).max(90).required(),
  lon: Joi.number().min(-180).max(180).required(),
});

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

    const { lat, lon } = value;

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
        center: {
          lat: result.centerLat,
          lon: result.centerLon,
        },
        corners: {
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
      alphabet: configResult.rows[0].alphabet,
    };

    try {
      // Try to decode
      const parts = pocketId.split('-');
      
      if (parts.length !== 6) {
        throw new Error('Pocket ID must have 6 levels');
      }

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (part.length !== 2) {
          throw new Error(`Level ${i} must have 2 characters`);
        }

        const rowChar = part[0];
        const colChar = part[1];

        if (!config.alphabet.includes(rowChar) || !config.alphabet.includes(colChar)) {
          throw new Error(`Level ${i} contains invalid characters`);
        }
      }

      res.json({
        valid: true,
        pocketId,
        levels: parts.length,
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
