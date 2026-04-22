const express = require('express');
const Joi = require('joi');
const nearestService = require('../services/NearestService');
const { query } = require('../config/database');
const { asyncHandler, AppError } = require('../middleware/errorHandler');

const router = express.Router();

const serializeNearestBranches = (branches) =>
  branches.map((branch) => ({
    id: branch.id,
    city: branch.city,
    lat: branch.lat,
    lon: branch.lon,
    pocketId: branch.pocketId,
    distance: Math.round(branch.distance),
    distanceKm: (branch.distance / 1000).toFixed(2),
  }));

// Validation schema
const nearestSchema = Joi.object({
  lat: Joi.number().min(-90).max(90).required(),
  lon: Joi.number().min(-180).max(180).required(),
  limit: Joi.number().integer().min(1).max(100).default(5),
  maxDistance: Joi.number().positive().optional(), // in meters
});

/**
 * POST /api/v1/nearest
 * Find nearest branches to a location
 */
router.post(
  '/',
  asyncHandler(async (req, res) => {
    // Validate request body
    const { error, value } = nearestSchema.validate(req.body);
    if (error) {
      throw new AppError(
        error.details[0].message,
        400,
        'VALIDATION_ERROR',
        error.details
      );
    }

    const { lat, lon, limit, maxDistance } = value;
    const branches = await nearestService.findNearestBranches({
      lat,
      lon,
      limit,
      maxDistance: maxDistance || null,
    });

    res.json({
      query: {
        lat,
        lon,
        limit,
        maxDistance,
      },
      count: branches.length,
      branches: serializeNearestBranches(branches),
    });
  })
);

/**
 * POST /api/v1/nearest/fallback
 * Fallback nearest search using Haversine (for offline mode)
 */
router.post(
  '/fallback',
  asyncHandler(async (req, res) => {
    // Validate request body
    const { error, value } = nearestSchema.validate(req.body);
    if (error) {
      throw new AppError(
        error.details[0].message,
        400,
        'VALIDATION_ERROR',
        error.details
      );
    }

    const { lat, lon, limit, maxDistance } = value;
    const branches = await nearestService.findNearestBranches({
      lat,
      lon,
      limit,
      maxDistance: maxDistance || null,
    });

    res.json({
      query: {
        lat,
        lon,
        limit,
        maxDistance,
      },
      count: branches.length,
      branches: serializeNearestBranches(branches),
      warning: 'Fallback endpoint is deprecated; returning indexed PostGIS nearest-branch results.',
    });
  })
);

/**
 * GET /api/v1/nearest/within-pocket/:pocketId
 * Find all branches within a specific Pocket ID cell
 */
router.get(
  '/within-pocket/:pocketId',
  asyncHandler(async (req, res) => {
    const { pocketId } = req.params;

    if (!pocketId) {
      throw new AppError('Pocket ID is required', 400, 'MISSING_POCKET_ID');
    }

    // Find branches with matching Pocket ID
    const result = await query(
      'SELECT id, city, lat, lon, pocket_id FROM branches WHERE pocket_id = $1',
      [pocketId]
    );

    res.json({
      pocketId,
      count: result.rows.length,
      branches: result.rows.map((row) => ({
        id: row.id,
        city: row.city,
        lat: row.lat,
        lon: row.lon,
        pocketId: row.pocket_id,
      })),
    });
  })
);

module.exports = router;
