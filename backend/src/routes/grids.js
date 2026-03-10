const express = require('express');
const { query } = require('../config/database');
const { asyncHandler, AppError } = require('../middleware/errorHandler');

const router = express.Router();
const UNASSIGNED_TILE_COLOR = '#E2E8F0';
const CANONICAL_POCKET_CODE_SQL_PATTERN = '^[0-9]{2}(?:-[0-9]{2}){0,4}$';
const BRANCH_TERRITORY_TABLE = 'branch_territories';
const EMPLOYEE_TERRITORY_TABLE = 'employee_territories';

const parseTileCoordinate = (value, name, min, max) => {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new AppError(`Invalid ${name}`, 400, 'INVALID_TILE_COORDINATE');
  }
  return parsed;
};

/**
 * GET /api/v1/grids/tiles/:z/:x/:y.mvt
 * Returns assigned grid vector tile with employee_id and color properties.
 */
router.get(
  '/tiles/:z/:x/:y.mvt',
  asyncHandler(async (req, res) => {
    const z = parseTileCoordinate(req.params.z, 'z', 0, 22);
    const maxIndex = 2 ** z - 1;
    const x = parseTileCoordinate(req.params.x, 'x', 0, maxIndex);
    const y = parseTileCoordinate(req.params.y, 'y', 0, maxIndex);
    const branchId = typeof req.query.branchId === 'string' && req.query.branchId.trim()
      ? req.query.branchId.trim()
      : null;
    const levelM = Number.isFinite(Number(req.query.levelM))
      ? Number.parseInt(String(req.query.levelM), 10)
      : null;

    let tileResult;
    try {
      tileResult = await query(
        `
        WITH tile_bounds AS (
          SELECT ST_TileEnvelope($1::integer, $2::integer, $3::integer) AS geom_3857
        ),
        branch_employee_map AS (
          SELECT
            be.branch_id,
            be.id::int AS branch_employee_id,
            be.employee_id::text AS employee_code,
            CASE
              WHEN be.color_code ~ '^#[0-9A-Fa-f]{6}$' THEN upper(be.color_code)
              ELSE $5::text
            END AS color
          FROM branch_employees be
          WHERE ($4::text IS NULL OR be.branch_id = $4::text)
        ),
        mvt_rows AS (
          SELECT
            bt.grid_code::text AS grid_cell_id,
            bt.branch_id,
            bt.grid_code::text AS pocket_id,
            bt.level_m::int AS level_m,
            COALESCE(
              employee_by_id.branch_employee_id::text,
              employee_by_code.branch_employee_id::text,
              COALESCE(et.employee_id::text, '')
            ) AS employee_id,
            COALESCE(
              employee_by_id.color,
              employee_by_code.color,
              $5::text
            ) AS color,
            ST_AsMVTGeom(
              ST_Transform(gc.geom, 3857),
              tile_bounds.geom_3857,
              4096,
              64,
              true
            ) AS geom
          FROM ${BRANCH_TERRITORY_TABLE} bt
          JOIN grid_cells gc
            ON gc.code = bt.grid_code
           AND gc.level_m = bt.level_m
          CROSS JOIN tile_bounds
          LEFT JOIN ${EMPLOYEE_TERRITORY_TABLE} et
            ON et.branch_id = bt.branch_id
           AND et.grid_code = bt.grid_code
          LEFT JOIN branch_employee_map employee_by_id
            ON employee_by_id.branch_id = et.branch_id
           AND employee_by_id.branch_employee_id = et.branch_employee_id
          LEFT JOIN branch_employee_map employee_by_code
            ON employee_by_code.branch_id = et.branch_id
           AND et.branch_employee_id IS NULL
           AND et.employee_id IS NOT NULL
           AND employee_by_code.employee_code = et.employee_id::text
          WHERE gc.geom IS NOT NULL
            AND NOT ST_IsEmpty(gc.geom)
            AND ST_Intersects(ST_Transform(gc.geom, 3857), tile_bounds.geom_3857)
            AND ($4::text IS NULL OR bt.branch_id = $4::text)
            AND ($6::integer IS NULL OR bt.level_m = $6::integer)
            AND bt.grid_code ~ $7::text
        )
        SELECT ST_AsMVT(mvt_rows, 'grid1', 4096, 'geom') AS tile
        FROM mvt_rows
      `,
        [z, x, y, branchId, UNASSIGNED_TILE_COLOR, levelM, CANONICAL_POCKET_CODE_SQL_PATTERN]
      );
    } catch (error) {
      if (error && (error.code === '42P01' || error.code === '42703')) {
        const message = String(error.message || '').toLowerCase();
        if (
          message.includes(BRANCH_TERRITORY_TABLE)
          || message.includes(EMPLOYEE_TERRITORY_TABLE)
          || message.includes('branch_employee_id')
          || message.includes('branch_employees')
        ) {
          throw new AppError(
            'Persistent territory tables are not initialized. Apply the persistent territory migration before requesting grid tiles.',
            503,
            'PERSISTENT_TERRITORY_TABLES_NOT_INITIALIZED'
          );
        }
      }
      throw error;
    }

    const tile = tileResult.rows[0]?.tile;
    const tileBuffer = tile === null || tile === undefined
      ? Buffer.alloc(0)
      : Buffer.from(tile);

    res.setHeader('Content-Type', 'application/vnd.mapbox-vector-tile');
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.send(tileBuffer);
  })
);

module.exports = router;
