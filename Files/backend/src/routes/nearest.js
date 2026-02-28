const express = require('express');
const Joi = require('joi');
const { query } = require('../config/database');
const { haversineDistance } = require('../utils/geometry');
const { asyncHandler, AppError } = require('../middleware/errorHandler');

const router = express.Router();

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

    // Use PostGIS for spatial query
    let queryText = `
      SELECT 
        id,
        city,
        lat,
        lon,
        pocket_id,
        ST_Distance(
          geom,
          ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
        ) as distance
      FROM branches
    `;

    const params = [lon, lat];

    // Add distance filter if specified
    if (maxDistance) {
      queryText += ` WHERE ST_DWithin(
        geom,
        ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
        $3
      )`;
      params.push(maxDistance);
    }

    queryText += ` ORDER BY distance LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await query(queryText, params);

    // Format results
    const branches = result.rows.map((row) => ({
      id: row.id,
      city: row.city,
      lat: row.lat,
      lon: row.lon,
      pocketId: row.pocket_id,
      distance: Math.round(row.distance), // meters
      distanceKm: (row.distance / 1000).toFixed(2),
    }));

    res.json({
      query: {
        lat,
        lon,
        limit,
        maxDistance,
      },
      count: branches.length,
      branches,
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

    // Get all branches (or use a reasonable limit)
    const result = await query(
      'SELECT id, city, lat, lon, pocket_id FROM branches LIMIT 10000'
    );

    // Calculate distances using Haversine
    const branchesWithDistance = result.rows.map((branch) => {
      const distance = haversineDistance(lat, lon, branch.lat, branch.lon);
      return {
        id: branch.id,
        city: branch.city,
        lat: branch.lat,
        lon: branch.lon,
        pocketId: branch.pocket_id,
        distance: Math.round(distance),
        distanceKm: (distance / 1000).toFixed(2),
      };
    });

    // Filter by max distance if specified
    let filtered = branchesWithDistance;
    if (maxDistance) {
      filtered = branchesWithDistance.filter((b) => b.distance <= maxDistance);
    }

    // Sort by distance and limit
    const nearest = filtered.sort((a, b) => a.distance - b.distance).slice(0, limit);

    res.json({
      query: {
        lat,
        lon,
        limit,
        maxDistance,
      },
      count: nearest.length,
      branches: nearest,
      warning: 'Using fallback calculation (Haversine). Results may be less accurate.',
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
