const express = require('express');
const Joi = require('joi');
const { query } = require('../config/database');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const logger = require('../config/logger');
const {
  SUPPORTED_LEVELS,
  PRECOMPUTED_LEVELS,
  ensurePrecomputedGrid,
  fetchGridCells,
  fetchGridTile,
  getMinZoomForLevel,
  warmGridTileCache,
  getGridWarmStatus,
} = require('../services/GridService');

const router = express.Router();

const listGridSchema = Joi.object({
  levelKm: Joi.number().valid(500, 100, 10, 5, 1).default(500),
});

const tileParamsSchema = Joi.object({
  levelKm: Joi.number().valid(500, 100, 10, 5, 1).required(),
  z: Joi.number().integer().min(0).max(22).required(),
  x: Joi.number().integer().min(0).required(),
  y: Joi.number().integer().min(0).required(),
});

const warmSchema = Joi.object({
  levelsKm: Joi.array().items(Joi.number().valid(500, 100, 10, 5, 1)).min(1).optional(),
  zooms: Joi.array().items(Joi.number().integer().min(0).max(22)).min(1).optional(),
  boundsList: Joi.array()
    .items(Joi.array().items(Joi.number()).length(4))
    .min(1)
    .optional(),
  maxTiles: Joi.number().integer().min(1).max(100000).optional(),
  concurrency: Joi.number().integer().min(1).max(64).optional(),
});

async function getActiveConfig() {
  const configResult = await query(
    'SELECT id, origin_lat, origin_lon, alphabet, version FROM config WHERE id = 1'
  );
  if (configResult.rows.length === 0) {
    throw new AppError('Configuration not found', 404, 'CONFIG_NOT_FOUND');
  }

  return {
    id: configResult.rows[0].id,
    originLat: configResult.rows[0].origin_lat,
    originLon: configResult.rows[0].origin_lon,
    alphabet: configResult.rows[0].alphabet,
    version: configResult.rows[0].version,
  };
}

router.get(
  '/manifest',
  asyncHandler(async (req, res) => {
    const config = await getActiveConfig();
    await ensurePrecomputedGrid(config);

    const apiVersion = process.env.API_VERSION || 'v1';
    const basePath = `/api/${apiVersion}/grids/tiles`;

    res.json({
      source: 'database-vector-tiles',
      configVersion: config.version,
      levelsKm: SUPPORTED_LEVELS.map((value) => value / 1000),
      tiles: {
        500: `${basePath}/500/{z}/{x}/{y}.pbf`,
        100: `${basePath}/100/{z}/{x}/{y}.pbf`,
        10: `${basePath}/10/{z}/{x}/{y}.pbf`,
        5: `${basePath}/5/{z}/{x}/{y}.pbf`,
        1: `${basePath}/1/{z}/{x}/{y}.pbf`,
      },
      bounds: [68.0, 6.5, 97.5, 37.5],
      center: [79.0, 22.5],
    });
  })
);

router.get(
  '/warm-status',
  asyncHandler(async (req, res) => {
    res.json(getGridWarmStatus());
  })
);

router.post(
  '/warm',
  asyncHandler(async (req, res) => {
    const { error, value } = warmSchema.validate(req.body || {});
    if (error) {
      throw new AppError(error.details[0].message, 400, 'VALIDATION_ERROR', error.details);
    }

    const config = await getActiveConfig();
    const levelsMeters = Array.isArray(value.levelsKm)
      ? value.levelsKm.map((km) => km * 1000)
      : undefined;

    warmGridTileCache({
      config,
      levelsMeters,
      zooms: value.zooms,
      boundsList: value.boundsList,
      maxTiles: value.maxTiles,
      concurrency: value.concurrency,
    }).catch((warmError) => {
      logger.error(`Grid warm request failed: ${warmError.message}`);
    });

    res.status(202).json({
      message: 'Grid cache warmup started',
      status: getGridWarmStatus(),
    });
  })
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { error, value } = listGridSchema.validate(req.query);
    if (error) {
      throw new AppError(error.details[0].message, 400, 'VALIDATION_ERROR', error.details);
    }

    const config = await getActiveConfig();
    await ensurePrecomputedGrid(config);

    const levelMeters = value.levelKm * 1000;
    if (!SUPPORTED_LEVELS.includes(levelMeters)) {
      throw new AppError('Unsupported grid level', 400, 'UNSUPPORTED_GRID_LEVEL');
    }

    if (!PRECOMPUTED_LEVELS.includes(levelMeters)) {
      throw new AppError(
        'Fine-grain levels are available only via vector tile endpoints',
        400,
        'GRID_LEVEL_TILE_ONLY'
      );
    }

    const cells = await fetchGridCells(config.version, levelMeters);

    res.json({
      levelKm: value.levelKm,
      levelMeters,
      source: 'database',
      configVersion: config.version,
      total: cells.length,
      cells,
    });
  })
);

router.get(
  '/tiles/:levelKm/:z/:x/:y.pbf',
  asyncHandler(async (req, res) => {
    const { error, value } = tileParamsSchema.validate(req.params);
    if (error) {
      throw new AppError(error.details[0].message, 400, 'VALIDATION_ERROR', error.details);
    }

    const config = await getActiveConfig();
    const levelMeters = value.levelKm * 1000;
    await ensurePrecomputedGrid(config, levelMeters);

    if (!SUPPORTED_LEVELS.includes(levelMeters)) {
      throw new AppError('Unsupported grid level', 400, 'UNSUPPORTED_GRID_LEVEL');
    }

    const minZoom = getMinZoomForLevel(levelMeters);
    if (value.z < minZoom) {
      throw new AppError(
        `Zoom ${value.z} is too low for ${value.levelKm} km level. Minimum zoom is ${minZoom}.`,
        400,
        'GRID_LEVEL_ZOOM_TOO_LOW'
      );
    }

    const tile = await fetchGridTile(
      config,
      levelMeters,
      value.z,
      value.x,
      value.y
    );

    if (!tile || tile.length === 0) {
      return res.status(204).send();
    }

    res.setHeader('Content-Type', 'application/vnd.mapbox-vector-tile');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.status(200).send(tile);
  })
);

module.exports = router;
