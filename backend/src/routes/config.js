const express = require('express');
const Joi = require('joi');
const { query, transaction } = require('../config/database');
const { validateAlphabet } = require('../utils/geometry');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const logger = require('../config/logger');

const router = express.Router();

const DEFAULT_GRID_LEVELS = [500000, 100000, 20000, 5000, 1000];
const GRID_LEVEL_IDS = ['500km', '100km', '20km', '5km', '1km'];
const DEFAULT_GRID_LEVEL_COLORS = Object.freeze({
  '500km': '#93C5FD',
  '100km': '#60A5FA',
  '20km': '#38BDF8',
  '5km': '#22D3EE',
  '1km': '#06B6D4'
});
const HEX_COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;

const normalizeGridLevelColorValue = (value, fallback) => {
  if (typeof value !== 'string') {
    return fallback;
  }

  const normalizedValue = value.trim();
  if (!HEX_COLOR_REGEX.test(normalizedValue)) {
    return fallback;
  }

  return normalizedValue.toUpperCase();
};

const normalizeGridLevelColors = (rawColors, fallbackColors = DEFAULT_GRID_LEVEL_COLORS) => {
  const normalizedFallback = {};
  GRID_LEVEL_IDS.forEach((levelId) => {
    normalizedFallback[levelId] = normalizeGridLevelColorValue(
      fallbackColors[levelId],
      DEFAULT_GRID_LEVEL_COLORS[levelId]
    );
  });

  const normalizedColors = { ...normalizedFallback };
  if (!rawColors || typeof rawColors !== 'object' || Array.isArray(rawColors)) {
    return normalizedColors;
  }

  GRID_LEVEL_IDS.forEach((levelId) => {
    normalizedColors[levelId] = normalizeGridLevelColorValue(
      rawColors[levelId],
      normalizedFallback[levelId]
    );
  });

  return normalizedColors;
};

const normalizeGridLevels = (rawGridLevels) => {
  let levels = [...DEFAULT_GRID_LEVELS];
  let colors = normalizeGridLevelColors(null);

  if (Array.isArray(rawGridLevels)) {
    const candidateLevels = rawGridLevels
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value > 0);
    if (candidateLevels.length === DEFAULT_GRID_LEVELS.length) {
      levels = candidateLevels;
    }
  } else if (rawGridLevels && typeof rawGridLevels === 'object') {
    const candidateLevelsRaw = Array.isArray(rawGridLevels.levels)
      ? rawGridLevels.levels
      : (Array.isArray(rawGridLevels.gridLevels) ? rawGridLevels.gridLevels : null);
    if (candidateLevelsRaw) {
      const candidateLevels = candidateLevelsRaw
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0);
      if (candidateLevels.length === DEFAULT_GRID_LEVELS.length) {
        levels = candidateLevels;
      }
    }

    const rawColors = (rawGridLevels.colors && typeof rawGridLevels.colors === 'object')
      ? rawGridLevels.colors
      : ((rawGridLevels.gridLevelColors && typeof rawGridLevels.gridLevelColors === 'object')
        ? rawGridLevels.gridLevelColors
        : null);
    colors = normalizeGridLevelColors(rawColors);
  }

  return {
    levels,
    gridLevelColors: colors,
    storagePayload: {
      levels,
      colors
    }
  };
};

// Validation schema
const configSchema = Joi.object({
  originLat: Joi.number().min(-90).max(90).required(),
  originLon: Joi.number().min(-180).max(180).required(),
  alphabet: Joi.string().length(30).required(),
  gridLevels: Joi.array().items(Joi.number().positive()).length(5).optional(),
  gridLevelColors: Joi.object({
    '500km': Joi.string().pattern(HEX_COLOR_REGEX),
    '100km': Joi.string().pattern(HEX_COLOR_REGEX),
    '20km': Joi.string().pattern(HEX_COLOR_REGEX),
    '5km': Joi.string().pattern(HEX_COLOR_REGEX),
    '1km': Joi.string().pattern(HEX_COLOR_REGEX)
  }).optional(),
});

const clearDataSchema = Joi.object({
  clearCustomerData: Joi.boolean().default(false),
  clearBranchData: Joi.boolean().default(false),
  clearPocketData: Joi.boolean().default(false)
});

const CLEARABLE_TABLES = new Set([
  'customer_pocket_mappings',
  'employee_territories',
  'branch_territories',
  'employee_grid_cells',
  'grid_cells',
  'branch_employees',
  'branches'
]);

const deleteRowsIfTableExists = async (client, tableName) => {
  if (!CLEARABLE_TABLES.has(tableName)) {
    throw new AppError(`Unsupported clear target table: ${tableName}`, 500, 'INVALID_CLEAR_TABLE');
  }

  const tableExistsResult = await client.query(
    'SELECT to_regclass($1) AS table_ref',
    [`public.${tableName}`]
  );
  if (!tableExistsResult.rows[0]?.table_ref) {
    return 0;
  }

  const deleteResult = await client.query(`DELETE FROM ${tableName}`);
  return deleteResult.rowCount || 0;
};

const countRowsIfTableExists = async (client, tableName) => {
  if (!CLEARABLE_TABLES.has(tableName)) {
    throw new AppError(`Unsupported clear target table: ${tableName}`, 500, 'INVALID_CLEAR_TABLE');
  }

  const tableExistsResult = await client.query(
    'SELECT to_regclass($1) AS table_ref',
    [`public.${tableName}`]
  );
  if (!tableExistsResult.rows[0]?.table_ref) {
    return 0;
  }

  const countResult = await client.query(`SELECT COUNT(*)::int AS row_count FROM ${tableName}`);
  return Number(countResult.rows[0]?.row_count || 0);
};

const truncateTablesCascadeIfExist = async (client, tableNames) => {
  const uniqueTableNames = Array.from(new Set(tableNames));
  const existingTables = [];
  const counts = {};

  for (const tableName of uniqueTableNames) {
    if (!CLEARABLE_TABLES.has(tableName)) {
      throw new AppError(`Unsupported clear target table: ${tableName}`, 500, 'INVALID_CLEAR_TABLE');
    }

    const tableExistsResult = await client.query(
      'SELECT to_regclass($1) AS table_ref',
      [`public.${tableName}`]
    );
    if (!tableExistsResult.rows[0]?.table_ref) {
      continue;
    }

    counts[tableName] = await countRowsIfTableExists(client, tableName);
    existingTables.push(tableName);
  }

  if (existingTables.length === 0) {
    return counts;
  }

  await client.query(`TRUNCATE TABLE ${existingTables.join(', ')} RESTART IDENTITY CASCADE`);
  return counts;
};

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
    const normalizedGridLevels = normalizeGridLevels(config.grid_levels);

    res.json({
      id: config.id,
      originLat: config.origin_lat,
      originLon: config.origin_lon,
      alphabet: config.alphabet,
      gridLevels: normalizedGridLevels.levels,
      gridLevelColors: normalizedGridLevels.gridLevelColors,
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

    const { originLat, originLon, alphabet, gridLevels, gridLevelColors } = value;

    // Validate alphabet
    const alphabetValidation = validateAlphabet(alphabet);
    if (!alphabetValidation.valid) {
      throw new AppError(
        alphabetValidation.error,
        400,
        'INVALID_ALPHABET'
      );
    }

    const existingConfigResult = await query('SELECT * FROM config WHERE id = 1');
    if (existingConfigResult.rows.length === 0) {
      throw new AppError('Configuration not found', 404, 'CONFIG_NOT_FOUND');
    }
    const existingConfig = existingConfigResult.rows[0];
    const existingGridLevels = normalizeGridLevels(existingConfig.grid_levels);

    const normalizedGridLevels = Array.isArray(gridLevels)
      ? gridLevels.map((value) => Number(value))
      : existingGridLevels.levels;
    const normalizedGridLevelColors = gridLevelColors
      ? normalizeGridLevelColors(gridLevelColors, existingGridLevels.gridLevelColors)
      : existingGridLevels.gridLevelColors;

    const gridLevelStoragePayload = {
      levels: normalizedGridLevels,
      colors: normalizedGridLevelColors
    };

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
        JSON.stringify(gridLevelStoragePayload),
      ]
    );

    if (result.rows.length === 0) {
      throw new AppError('Configuration not found', 404, 'CONFIG_NOT_FOUND');
    }

    const config = result.rows[0];
    const updatedGridLevels = normalizeGridLevels(config.grid_levels);

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
        gridLevels: updatedGridLevels.levels,
        gridLevelColors: updatedGridLevels.gridLevelColors,
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
        ...(() => {
          const normalizedGridLevels = normalizeGridLevels(row.grid_levels);
          return {
            gridLevels: normalizedGridLevels.levels,
            gridLevelColors: normalizedGridLevels.gridLevelColors
          };
        })(),
        id: row.id,
        configId: row.config_id,
        originLat: row.origin_lat,
        originLon: row.origin_lon,
        alphabet: row.alphabet,
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

/**
 * POST /api/v1/config/clear-data
 * Clear selected domain data from the system.
 */
router.post(
  '/clear-data',
  asyncHandler(async (req, res) => {
    const { error, value } = clearDataSchema.validate(req.body || {}, { stripUnknown: true });
    if (error) {
      throw new AppError(
        error.details[0].message,
        400,
        'VALIDATION_ERROR',
        error.details
      );
    }

    let {
      clearCustomerData = false,
      clearBranchData = false,
      clearPocketData = false
    } = value;

    // Branch deletion depends on customer mappings that reference branches.
    if (clearBranchData) {
      clearCustomerData = true;
    }

    if (!clearCustomerData && !clearBranchData && !clearPocketData) {
      throw new AppError(
        'Select at least one data domain to clear.',
        400,
        'NO_CLEAR_SELECTION'
      );
    }

    // --- ORIGINAL BACKUP ---
    // const orderedTargets = [];
    // if (clearCustomerData) {
    //   orderedTargets.push('customer_pocket_mappings');
    // }
    // if (clearPocketData) {
    //   orderedTargets.push('employee_territories');
    //   orderedTargets.push('branch_territories');
    //   orderedTargets.push('employee_grid_cells');
    //   orderedTargets.push('grid_cells');
    // }
    // if (clearBranchData) {
    //   orderedTargets.push('branch_employees');
    //   orderedTargets.push('branches');
    // }
    //
    // const deletedRows = await transaction(async (client) => {
    //   const counts = {};
    //   const seen = new Set();
    //
    //   for (const tableName of orderedTargets) {
    //     if (seen.has(tableName)) {
    //       continue;
    //     }
    //     seen.add(tableName);
    //     counts[tableName] = await deleteRowsIfTableExists(client, tableName);
    //   }
    //
    //   return counts;
    // });

    const deletedRows = await transaction(async (client) => {
      const counts = {};

      if (clearCustomerData) {
        counts.customer_pocket_mappings = await deleteRowsIfTableExists(client, 'customer_pocket_mappings');
      }

      if (clearPocketData) {
        const pocketCounts = await truncateTablesCascadeIfExist(
          client,
          ['employee_territories', 'branch_territories', 'employee_grid_cells', 'grid_cells']
        );
        Object.assign(counts, pocketCounts);
      }

      if (clearBranchData) {
        counts.branch_employees = await deleteRowsIfTableExists(client, 'branch_employees');
        counts.branches = await deleteRowsIfTableExists(client, 'branches');
      }

      return counts;
    });

    logger.warn('System data clear executed', {
      clearCustomerData,
      clearBranchData,
      clearPocketData,
      deletedRows
    });

    res.json({
      message: 'Selected data has been cleared successfully.',
      selection: {
        clearCustomerData,
        clearBranchData,
        clearPocketData
      },
      deletedRows
    });
  })
);

module.exports = router;
