const express = require('express');
const { query, transaction } = require('../config/database');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { decodePocketId } = require('../utils/geometry');

const router = express.Router();
const BRANCH_TERRITORY_TABLE = 'branch_territories';
const EMPLOYEE_TERRITORY_TABLE = 'employee_territories';
const DEFAULT_EMPLOYEE_COLOR = '#D50711';

const acquireBranchTerritoryLock = async (client, branchId) => {
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtext($1::text))',
    [`territory:${String(branchId || '').trim()}`]
  );
};

/**
 * GET /api/v1/territories/employees/:branchId
 * Returns active employee master records for the branch.
 */
router.get(
  '/employees/:branchId',
  asyncHandler(async (req, res) => {
    const branchId = String(req.params.branchId || '').trim();
    if (!branchId) {
      throw new AppError('Branch ID is required', 400, 'MISSING_BRANCH_ID');
    }

    const branchExistsResult = await query(
      'SELECT id, city FROM branches WHERE id = $1',
      [branchId]
    );
    if (branchExistsResult.rows.length === 0) {
      throw new AppError('Branch not found', 404, 'BRANCH_NOT_FOUND');
    }

    const employeesResult = await query(
      `
        SELECT
          id::int AS id,
          branch_id,
          employee_id::text AS employee_code,
          COALESCE(
            NULLIF(btrim(name), ''),
            NULLIF(btrim(employee_name), ''),
            NULLIF(btrim(employee_id), ''),
            'Employee ' || id::text
          )::text AS name,
          CASE
            WHEN color_code ~ '^#[0-9A-Fa-f]{6}$' THEN upper(color_code)
            ELSE $2
          END AS color_code,
          max_capacity
        FROM branch_employees
        WHERE branch_id = $1
          AND is_active = TRUE
        ORDER BY id
      `,
      [branchId, DEFAULT_EMPLOYEE_COLOR]
    );

    res.json({
      branchId,
      branchCity: branchExistsResult.rows[0].city || '',
      employees: employeesResult.rows.map((row) => ({
        id: String(row.id),
        branchId: row.branch_id,
        employeeCode: row.employee_code,
        name: row.name,
        colorCode: row.color_code,
        maxCapacity: row.max_capacity === null ? null : Number(row.max_capacity)
      }))
    });
  })
);

/**
 * PUT /api/v1/territories/assign-manual
 * Manual Pocket -> Employee assignment using persistent territory tables.
 */
router.put(
  '/assign-manual',
  asyncHandler(async (req, res) => {
    const branchId = String(req.body?.branchId || '').trim();
    const pocketId = String(req.body?.pocketId || '').trim();
    const newEmployeeId = String(req.body?.newEmployeeId || '').trim();
    const requestedLevelMetersRaw =
      req.body?.level_m
      ?? req.body?.levelM
      ?? req.query?.level_m
      ?? req.query?.levelM;
    const requestedLevelMeters = Number.isFinite(Number(requestedLevelMetersRaw))
      ? Math.round(Number(requestedLevelMetersRaw))
      : null;

    if (!branchId) {
      throw new AppError('branchId is required', 400, 'MISSING_BRANCH_ID');
    }
    if (!pocketId) {
      throw new AppError('pocketId is required', 400, 'MISSING_POCKET_ID');
    }
    if (!newEmployeeId) {
      throw new AppError('newEmployeeId is required', 400, 'MISSING_EMPLOYEE_ID');
    }

    const parsedEmployeeId = Number.parseInt(newEmployeeId, 10);
    if (!Number.isInteger(parsedEmployeeId) || parsedEmployeeId <= 0) {
      throw new AppError('newEmployeeId must be a valid branch employee ID', 400, 'INVALID_EMPLOYEE_ID');
    }

    const branchExistsResult = await query(
      'SELECT id, city FROM branches WHERE id = $1',
      [branchId]
    );
    if (branchExistsResult.rows.length === 0) {
      throw new AppError('Branch not found', 404, 'BRANCH_NOT_FOUND');
    }

    const employeeResult = await query(
      `
        SELECT
          id::int AS id,
          employee_id::text AS employee_code,
          COALESCE(
            NULLIF(btrim(name), ''),
            NULLIF(btrim(employee_name), ''),
            NULLIF(btrim(employee_id), ''),
            'Employee ' || id::text
          )::text AS name,
          CASE
            WHEN color_code ~ '^#[0-9A-Fa-f]{6}$' THEN upper(color_code)
            ELSE $3
          END AS color_code
        FROM branch_employees
        WHERE branch_id = $1
          AND id = $2::int
          AND is_active = TRUE
        LIMIT 1
      `,
      [branchId, parsedEmployeeId, DEFAULT_EMPLOYEE_COLOR]
    );

    if (employeeResult.rows.length === 0) {
      throw new AppError('Employee not found for branch', 404, 'EMPLOYEE_NOT_FOUND');
    }

    const employee = employeeResult.rows[0];
    const configResult = await query(
      `
        SELECT
          origin_lat,
          origin_lon,
          alphabet
        FROM config
        WHERE id = 1
        LIMIT 1
      `
    );
    let decodedPocketCenter = null;
    if (configResult.rows.length > 0) {
      try {
        const decodedPocket = decodePocketId(pocketId, {
          originLat: Number(configResult.rows[0].origin_lat),
          originLon: Number(configResult.rows[0].origin_lon),
          alphabet: String(configResult.rows[0].alphabet || '')
        });
        if (Number.isFinite(decodedPocket.centerLat) && Number.isFinite(decodedPocket.centerLon)) {
          decodedPocketCenter = {
            lat: Number(decodedPocket.centerLat),
            lon: Number(decodedPocket.centerLon)
          };
        }
      } catch {
        decodedPocketCenter = null;
      }
    }

    const updatePayload = await transaction(async (client) => {
      await acquireBranchTerritoryLock(client, branchId);

      // --- ORIGINAL BACKUP ---
      // const upsertBranchTerritoryResult = await client.query(
      //   `
      //     WITH selected_grid AS (
      //       SELECT
      //         gc.code::varchar AS grid_code,
      //         gc.level_m::int AS level_m
      //       FROM grid_cells gc
      //       WHERE gc.code = $2
      //         AND ($3::integer IS NULL OR gc.level_m = $3::integer)
      //       ORDER BY
      //         CASE
      //           WHEN $3::integer IS NOT NULL AND gc.level_m = $3::integer THEN 0
      //           ELSE 1
      //         END,
      //         gc.level_m DESC
      //       LIMIT 1
      //     )
      //     INSERT INTO ${BRANCH_TERRITORY_TABLE} (
      //       branch_id,
      //       grid_code,
      //       level_m
      //     )
      //     SELECT
      //       $1::varchar AS branch_id,
      //       selected_grid.grid_code,
      //       selected_grid.level_m
      //     FROM selected_grid
      //     ON CONFLICT (branch_id, grid_code)
      //     DO UPDATE SET
      //       level_m = EXCLUDED.level_m,
      //       updated_at = CURRENT_TIMESTAMP
      //     RETURNING grid_code, level_m
      //   `,
      //   [branchId, pocketId, requestedLevelMeters]
      // );
      const upsertBranchTerritoryResult = await client.query(
        `
          WITH direct_match AS (
            SELECT
              gc.code::varchar AS grid_code,
              gc.level_m::int AS level_m
            FROM grid_cells gc
            WHERE gc.code = $2
              AND ($3::integer IS NULL OR gc.level_m = $3::integer)
            ORDER BY gc.level_m DESC
            LIMIT 1
          ),
          canonical_match AS (
            SELECT
              gc.code::varchar AS grid_code,
              gc.level_m::int AS level_m
            FROM grid_cells gc
            WHERE $4::boolean = TRUE
              AND ($3::integer IS NULL OR gc.level_m = $3::integer)
              AND gc.geom IS NOT NULL
              AND NOT ST_IsEmpty(gc.geom)
              AND ST_Covers(
                gc.geom,
                ST_SetSRID(
                  ST_MakePoint($5::double precision, $6::double precision),
                  4326
                )
              )
            ORDER BY gc.level_m DESC, gc.code ASC
            LIMIT 1
          ),
          selected_grid AS (
            SELECT
              candidate.grid_code,
              candidate.level_m
            FROM (
              SELECT
                direct_match.grid_code,
                direct_match.level_m,
                0 AS priority
              FROM direct_match
              UNION ALL
              SELECT
                canonical_match.grid_code,
                canonical_match.level_m,
                1 AS priority
              FROM canonical_match
            ) candidate
            ORDER BY candidate.priority
            LIMIT 1
          )
          INSERT INTO ${BRANCH_TERRITORY_TABLE} (
            branch_id,
            grid_code,
            level_m
          )
          SELECT
            $1::varchar AS branch_id,
            selected_grid.grid_code,
            selected_grid.level_m
          FROM selected_grid
          ON CONFLICT (branch_id, grid_code)
          DO UPDATE SET
            level_m = EXCLUDED.level_m,
            updated_at = CURRENT_TIMESTAMP
          RETURNING grid_code, level_m
        `,
        [
          branchId,
          pocketId,
          requestedLevelMeters,
          Boolean(decodedPocketCenter),
          decodedPocketCenter ? decodedPocketCenter.lon : null,
          decodedPocketCenter ? decodedPocketCenter.lat : null
        ]
      );

      if (upsertBranchTerritoryResult.rows.length === 0) {
        throw new AppError(
          'Pocket is not available in master grid_cells and cannot be assigned.',
          404,
          'POCKET_NOT_FOUND'
        );
      }
      const resolvedGridCode = String(upsertBranchTerritoryResult.rows[0]?.grid_code || '').trim();
      if (!resolvedGridCode) {
        throw new AppError(
          'Resolved grid code is empty. Manual assignment cannot continue.',
          422,
          'POCKET_RESOLUTION_FAILED'
        );
      }

      // --- ORIGINAL BACKUP ---
      // await client.query(
      //   `
      //     INSERT INTO ${EMPLOYEE_TERRITORY_TABLE} (
      //       branch_employee_id,
      //       employee_id,
      //       branch_id,
      //       grid_code
      //     )
      //     VALUES ($3::int, $4::varchar, $1::varchar, $2::varchar)
      //     ON CONFLICT (branch_id, grid_code)
      //     DO UPDATE SET
      //       branch_employee_id = EXCLUDED.branch_employee_id,
      //       employee_id = EXCLUDED.employee_id,
      //       updated_at = CURRENT_TIMESTAMP
      //   `,
      //   [branchId, pocketId, Number(employee.id), String(employee.employee_code || '')]
      // );
      await client.query(
        `
          INSERT INTO ${EMPLOYEE_TERRITORY_TABLE} (
            branch_employee_id,
            employee_id,
            branch_id,
            grid_code
          )
          VALUES ($3::int, $4::varchar, $1::varchar, $2::varchar)
          ON CONFLICT (branch_id, grid_code)
          DO UPDATE SET
            branch_employee_id = EXCLUDED.branch_employee_id,
            employee_id = EXCLUDED.employee_id,
            updated_at = CURRENT_TIMESTAMP
        `,
        [branchId, resolvedGridCode, Number(employee.id), String(employee.employee_code || '')]
      );

      // --- ORIGINAL BACKUP ---
      // const legacyGridUpdateResult = await client.query(
      //   `
      //     UPDATE employee_grid_cells
      //     SET
      //       assigned_employee_id = $3::varchar,
      //       updated_at = CURRENT_TIMESTAMP
      //     WHERE branch_id = $1
      //       AND (
      //         pocket_id::text = $2
      //         OR id::text = $2
      //       )
      //   `,
      //   [branchId, pocketId, String(employee.employee_code || '')]
      // );
      const legacyGridUpdateResult = await client.query(
        `
          UPDATE employee_grid_cells
          SET
            assigned_employee_id = $3::varchar,
            updated_at = CURRENT_TIMESTAMP
          WHERE branch_id = $1
            AND (
              pocket_id::text = $2
              OR id::text = $2
              OR pocket_id::text = $4
              OR id::text = $4
            )
        `,
        [branchId, resolvedGridCode, String(employee.employee_code || ''), pocketId]
      );

      return {
        updatedLegacyGridRows: Number(legacyGridUpdateResult.rowCount || 0),
        levelM: Number(upsertBranchTerritoryResult.rows[0]?.level_m || 0),
        resolvedGridCode
      };
    });

    res.json({
      branchId,
      branchCity: branchExistsResult.rows[0].city || '',
      pocketId,
      resolvedGridCode: String(updatePayload.resolvedGridCode || ''),
      updated: true,
      updatedLegacyGridRows: updatePayload.updatedLegacyGridRows,
      levelM: Number(updatePayload.levelM || 0),
      employee: {
        id: String(employee.id),
        employeeCode: String(employee.employee_code || ''),
        name: employee.name,
        colorCode: employee.color_code
      }
    });
  })
);

module.exports = router;
