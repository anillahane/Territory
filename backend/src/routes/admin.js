const express = require('express');
// --- ORIGINAL BACKUP ---
// const { query } = require('../config/database');
const { query, transaction } = require('../config/database');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const batchRoutes = require('./batch');

const router = express.Router();
const batchAllocationInternals = batchRoutes?.allocationInternals || {};

const TIER2_LEVELS_METERS = [20000, 5000, 1000];
// --- ORIGINAL BACKUP ---
// const PERSISTED_OPERATIONAL_LEVELS_METERS = [5000, 1000];
const PERSISTED_OPERATIONAL_LEVELS_METERS = [5000];
const TIER2_GENERATION_RADIUS_METERS = 100000;
const TERRITORY_VALIDATION_RADIUS_METERS = 50000;
const DEFAULT_GLOBAL_REALLOCATION_LEVEL_METERS = 5000;
const TERRITORY_REPAIR_REASON = Object.freeze({
  MISSING_TIER2_GRID: 'MISSING_TIER2_GRID',
  MISSING_PERSISTED_5KM_LAYOUT: 'MISSING_PERSISTED_5KM_LAYOUT',
  GHOST_DATA_DETECTED: 'GHOST_DATA_DETECTED'
});

const toBoolean = (value) => value === true || value === 't' || value === 1 || value === '1';

const resolveBranchActiveFilterSql = async () => {
  const hasIsActiveColumnResult = await query(
    `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'branches'
          AND column_name = 'is_active'
      ) AS has_is_active
    `
  );

  const hasIsActiveColumn = toBoolean(hasIsActiveColumnResult.rows[0]?.has_is_active);
  return hasIsActiveColumn
    ? 'WHERE COALESCE(branches.is_active, true) = true'
    : '';
};

const REQUIRED_GLOBAL_REALLOCATION_HELPERS = [
  'acquireBranchTerritoryLock',
  'ensureTier2MasterTilesAroundBranches',
  'ensureBranchCatchmentCoverage',
  'clearBranchPersistentTerritoryState',
  'runCoreAndDonutAllocation',
  'materializeClockwiseContiguousAllocation',
  'persistBranchEmployeeTerritories',
  'runTwoWayAllocationSync',
  'resolveLatestMappingsJobId'
];

const resolveGlobalReallocationLevelMeters = (rawLevelMeters) => {
  const parsed = Number(rawLevelMeters);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_GLOBAL_REALLOCATION_LEVEL_METERS;
  }
  return Math.round(parsed);
};

/**
 * GET /api/v1/admin/territory-health
 * Branch-level data preparedness and territory health summary.
 */
router.get(
  '/territory-health',
  asyncHandler(async (req, res) => {
    const branchActiveFilterSql = await resolveBranchActiveFilterSql();

    let healthResult;
    try {
      healthResult = await query(
        `
          WITH active_branches AS (
            SELECT
              branches.id::text AS branch_id,
              COALESCE(
                NULLIF(BTRIM(branches.city), ''),
                'Branch ' || branches.id::text
              ) AS branch_name,
              branches.lat::double precision AS branch_lat,
              branches.lon::double precision AS branch_lon,
              COALESCE(
                branches.geom::geometry,
                ST_SetSRID(ST_MakePoint(branches.lon, branches.lat), 4326)
              ) AS branch_geom
            FROM branches
            ${branchActiveFilterSql}
          )
          SELECT
            active_branches.branch_id,
            active_branches.branch_name,
            (
              COALESCE((
                SELECT COUNT(DISTINCT gc.level_m)::int
                FROM grid_cells gc
                WHERE gc.level_m = ANY($1::int[])
                  AND gc.min_lat IS NOT NULL
                  AND gc.max_lat IS NOT NULL
                  AND gc.min_lng IS NOT NULL
                  AND gc.max_lng IS NOT NULL
                  AND gc.max_lat >= active_branches.branch_lat - ($2::double precision / 111320.0)
                  AND gc.min_lat <= active_branches.branch_lat + ($2::double precision / 111320.0)
                  AND gc.max_lng >= active_branches.branch_lon - (
                    $2::double precision
                    / (111320.0 * GREATEST(ABS(COS(RADIANS(active_branches.branch_lat))), 0.1))
                  )
                  AND gc.min_lng <= active_branches.branch_lon + (
                    $2::double precision
                    / (111320.0 * GREATEST(ABS(COS(RADIANS(active_branches.branch_lat))), 0.1))
                  )
              ), 0) = COALESCE(array_length($1::int[], 1), 0)
            ) AS is_grid_generated,
            (
              NOT EXISTS (
                SELECT 1
                FROM branch_territories bt
                WHERE bt.branch_id = active_branches.branch_id
                  AND bt.level_m = ANY($4::int[])
              )
            ) AS missing_persisted_5km_layout,
            (
              EXISTS (
                SELECT 1
                FROM branch_territories bt
                LEFT JOIN grid_cells gc
                  ON gc.code = bt.grid_code
                 AND gc.level_m = bt.level_m
                WHERE bt.branch_id = active_branches.branch_id
                  AND bt.level_m = ANY($4::int[])
                  AND (
                    gc.code IS NULL
                    OR gc.geom IS NULL
                    OR ST_IsEmpty(gc.geom)
                    OR NOT ST_DWithin(
                      gc.geom::geography,
                      active_branches.branch_geom::geography,
                      $3::double precision
                    )
                  )
              )
            ) AS ghost_data_detected,
            (
              NOT EXISTS (
                SELECT 1
                FROM branch_territories bt
                WHERE bt.branch_id = active_branches.branch_id
                  AND bt.level_m = ANY($4::int[])
              )
              OR EXISTS (
                -- --- ORIGINAL BACKUP ---
                -- SELECT 1
                -- FROM employee_territories et
                -- LEFT JOIN grid_cells gc
                --   ON gc.code = et.grid_code
                -- WHERE et.branch_id = active_branches.branch_id
                --   AND (
                --     gc.code IS NULL
                --     OR gc.geom IS NULL
                --     OR ST_IsEmpty(gc.geom)
                --     OR gc.min_lat IS NULL
                --     OR gc.max_lat IS NULL
                --     OR gc.min_lng IS NULL
                --     OR gc.max_lng IS NULL
                --     OR gc.max_lat < active_branches.branch_lat - ($3::double precision / 111320.0)
                --     OR gc.min_lat > active_branches.branch_lat + ($3::double precision / 111320.0)
                --     OR gc.max_lng < active_branches.branch_lon - (
                --       $3::double precision
                --       / (111320.0 * GREATEST(ABS(COS(RADIANS(active_branches.branch_lat))), 0.1))
                --     )
                --     OR gc.min_lng > active_branches.branch_lon + (
                --       $3::double precision
                --       / (111320.0 * GREATEST(ABS(COS(RADIANS(active_branches.branch_lat))), 0.1))
                --     )
                --     OR (
                --       gc.max_lat >= active_branches.branch_lat - ($3::double precision / 111320.0)
                --       AND gc.min_lat <= active_branches.branch_lat + ($3::double precision / 111320.0)
                --       AND gc.max_lng >= active_branches.branch_lon - (
                --         $3::double precision
                --         / (111320.0 * GREATEST(ABS(COS(RADIANS(active_branches.branch_lat))), 0.1))
                --       )
                --       AND gc.min_lng <= active_branches.branch_lon + (
                --         $3::double precision
                --         / (111320.0 * GREATEST(ABS(COS(RADIANS(active_branches.branch_lat))), 0.1))
                --       )
                --       AND NOT ST_DWithin(
                --         gc.geom::geography,
                --         active_branches.branch_geom::geography,
                --         $3::double precision
                --       )
                --     )
                --   )
                --   AND (
                --     NOT EXISTS (
                --       SELECT 1
                --       FROM branch_territories bt2
                --       WHERE bt2.branch_id = et.branch_id
                --         AND bt2.grid_code = et.grid_code
                --     )
                --     OR EXISTS (
                --       SELECT 1
                --       FROM branch_territories bt3
                --       WHERE bt3.branch_id = et.branch_id
                --         AND bt3.grid_code = et.grid_code
                --         AND bt3.level_m = ANY($4::int[])
                --     )
                --   )
                SELECT 1
                FROM branch_territories bt
                LEFT JOIN grid_cells gc
                  ON gc.code = bt.grid_code
                 AND gc.level_m = bt.level_m
                WHERE bt.branch_id = active_branches.branch_id
                  AND bt.level_m = ANY($4::int[])
                  AND (
                    gc.code IS NULL
                    OR gc.geom IS NULL
                    OR ST_IsEmpty(gc.geom)
                    OR NOT ST_DWithin(
                      gc.geom::geography,
                      active_branches.branch_geom::geography,
                      $3::double precision
                    )
                  )
              )
            ) AS needs_repair,
            COALESCE((
              SELECT COUNT(*)::int
              FROM grid_cells gc
              WHERE gc.allocated_employee_id IS NOT NULL
                AND gc.min_lat IS NOT NULL
                AND gc.max_lat IS NOT NULL
                AND gc.min_lng IS NOT NULL
                AND gc.max_lng IS NOT NULL
                AND gc.max_lat >= active_branches.branch_lat - ($3::double precision / 111320.0)
                AND gc.min_lat <= active_branches.branch_lat + ($3::double precision / 111320.0)
                AND gc.max_lng >= active_branches.branch_lon - (
                  $3::double precision
                  / (111320.0 * GREATEST(ABS(COS(RADIANS(active_branches.branch_lat))), 0.1))
                )
                AND gc.min_lng <= active_branches.branch_lon + (
                  $3::double precision
                  / (111320.0 * GREATEST(ABS(COS(RADIANS(active_branches.branch_lat))), 0.1))
                )
            ), 0)::int AS assigned_pockets_count
          FROM active_branches
          ORDER BY active_branches.branch_id
        `,
        [
          TIER2_LEVELS_METERS,
          Number(TIER2_GENERATION_RADIUS_METERS),
          Number(TERRITORY_VALIDATION_RADIUS_METERS),
          PERSISTED_OPERATIONAL_LEVELS_METERS
        ]
      );
    } catch (error) {
      if (error && (error.code === '42P01' || error.code === '42703')) {
        throw new AppError(
          'Territory health tables are not initialized. Run migrations before using admin health.',
          503,
          'ADMIN_TERRITORY_HEALTH_TABLES_NOT_INITIALIZED'
        );
      }
      throw error;
    }

    // --- ORIGINAL BACKUP ---
    // const branchSummaries = (healthResult.rows || []).map((row) => ({
    //   branch_id: String(row.branch_id || ''),
    //   branch_name: String(row.branch_name || ''),
    //   is_grid_generated: toBoolean(row.is_grid_generated),
    //   needs_repair: toBoolean(row.needs_repair),
    //   assigned_pockets_count: Number(row.assigned_pockets_count || 0)
    // }));
    const branchSummaries = (healthResult.rows || []).map((row) => {
      const isGridGenerated = toBoolean(row.is_grid_generated);
      const missingTier2Grid = !isGridGenerated;
      const missingPersistedLayout = toBoolean(row.missing_persisted_5km_layout);
      const ghostDataDetected = toBoolean(row.ghost_data_detected);
      const repairReason = [];

      if (missingTier2Grid) {
        repairReason.push(TERRITORY_REPAIR_REASON.MISSING_TIER2_GRID);
      }
      if (missingPersistedLayout) {
        repairReason.push(TERRITORY_REPAIR_REASON.MISSING_PERSISTED_5KM_LAYOUT);
      }
      if (ghostDataDetected) {
        repairReason.push(TERRITORY_REPAIR_REASON.GHOST_DATA_DETECTED);
      }

      const needsRepair = repairReason.length > 0 || toBoolean(row.needs_repair);

      return {
        branch_id: String(row.branch_id || ''),
        branch_name: String(row.branch_name || ''),
        is_grid_generated: isGridGenerated,
        needs_repair: needsRepair,
        repair_reason: needsRepair ? repairReason : null,
        assigned_pockets_count: Number(row.assigned_pockets_count || 0)
      };
    });

    res.json({
      generatedAt: new Date().toISOString(),
      summary: {
        totalBranches: branchSummaries.length,
        branchesNeedingRepair: branchSummaries.filter((row) => row.needs_repair).length,
        branchesWithGeneratedGrid: branchSummaries.filter((row) => row.is_grid_generated).length
      },
      branches: branchSummaries
    });
  })
);

/**
 * GET /api/v1/admin/grid-cells
 * Paginated raw master tile viewer.
 */
router.get(
  '/grid-cells',
  asyncHandler(async (req, res) => {
    const rawPage = Number(req.query?.page);
    const rawLimit = Number(req.query?.limit);

    const page = Number.isFinite(rawPage) && rawPage > 0
      ? Math.floor(rawPage)
      : 1;
    const limit = Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(Math.floor(rawLimit), 500)
      : 50;
    const offset = (page - 1) * limit;

    let rowsResult;
    let countResult;
    try {
      rowsResult = await query(
        `
          SELECT
            gc.code::text AS pocket_id,
            gc.level_m::int AS level_m,
            gc.min_lat::double precision AS min_lat,
            gc.max_lat::double precision AS max_lat,
            gc.min_lng::double precision AS min_lng,
            gc.max_lng::double precision AS max_lng,
            gc.allocated_employee_id::int AS allocated_employee_id
          FROM grid_cells gc
          ORDER BY gc.level_m DESC, gc.code
          LIMIT $1 OFFSET $2
        `,
        [limit, offset]
      );

      countResult = await query(
        `
          SELECT COUNT(*)::bigint AS total_records
          FROM grid_cells
        `
      );
    } catch (error) {
      if (error && (error.code === '42P01' || error.code === '42703')) {
        throw new AppError(
          'Grid cell master table is not initialized. Run migrations before opening Master Tile Viewer.',
          503,
          'ADMIN_GRID_CELLS_TABLES_NOT_INITIALIZED'
        );
      }
      throw error;
    }

    const total = Number(countResult.rows[0]?.total_records || 0);
    const data = (rowsResult.rows || []).map((row) => ({
      pocket_id: String(row.pocket_id || ''),
      level_m: Number(row.level_m || 0),
      min_lat: row.min_lat === null ? null : Number(row.min_lat),
      max_lat: row.max_lat === null ? null : Number(row.max_lat),
      min_lng: row.min_lng === null ? null : Number(row.min_lng),
      max_lng: row.max_lng === null ? null : Number(row.max_lng),
      allocated_employee_id: row.allocated_employee_id === null
        ? null
        : Number(row.allocated_employee_id)
    }));

    res.json({
      data,
      total,
      page,
      limit
    });
  })
);

/**
 * POST /api/v1/admin/batch-reallocate-all
 * One-click global force repair + territory reallocation for all active branches.
 */
router.post(
  '/batch-reallocate-all',
  asyncHandler(async (req, res) => {
    const missingHelpers = REQUIRED_GLOBAL_REALLOCATION_HELPERS.filter(
      (helperName) => typeof batchAllocationInternals?.[helperName] !== 'function'
    );
    if (missingHelpers.length > 0) {
      throw new AppError(
        `Batch allocation internals are unavailable: ${missingHelpers.join(', ')}`,
        503,
        'BATCH_REALLOCATION_INTERNALS_UNAVAILABLE'
      );
    }

    const requestedLevelMeters =
      req.body?.levelMeters
      ?? req.body?.level_m
      ?? req.query?.levelMeters
      ?? req.query?.level_m;
    const levelMeters = resolveGlobalReallocationLevelMeters(requestedLevelMeters);
    if (!TIER2_LEVELS_METERS.includes(levelMeters)) {
      throw new AppError(
        `Unsupported levelMeters ${levelMeters}. Supported values: ${TIER2_LEVELS_METERS.join(', ')}`,
        400,
        'INVALID_LEVEL_METERS'
      );
    }

    const branchActiveFilterSql = await resolveBranchActiveFilterSql();
    const activeBranchesResult = await query(
      `
        SELECT branches.id::text AS branch_id
        FROM branches
        ${branchActiveFilterSql}
        ORDER BY branches.id::text
      `
    );
    const branchIds = (activeBranchesResult.rows || [])
      .map((row) => String(row.branch_id || '').trim())
      .filter(Boolean);

    if (branchIds.length === 0) {
      res.json({
        generatedAt: new Date().toISOString(),
        levelMeters,
        totalBranches: 0,
        successCount: 0,
        failedCount: 0,
        latestJobId: null,
        branches: []
      });
      return;
    }

    const latestJobId = await batchAllocationInternals.resolveLatestMappingsJobId();
    if (!latestJobId) {
      throw new AppError(
        'No customer mappings available. Upload/process customer mappings before running global reallocation.',
        404,
        'NO_MAPPINGS'
      );
    }

    const configResult = await query(
      `
        SELECT
          version,
          origin_lat,
          origin_lon,
          alphabet,
          grid_levels
        FROM config
        WHERE id = 1
        LIMIT 1
      `
    );
    if (configResult.rows.length === 0) {
      throw new AppError(
        'System pocket configuration is not initialized. Configure origin/alphabet/grid levels before running global sync.',
        503,
        'POCKET_CONFIG_UNAVAILABLE'
      );
    }

    const activePocketConfig = {
      configVersion: Number(configResult.rows[0].version || 1),
      originLat: Number(configResult.rows[0].origin_lat),
      originLon: Number(configResult.rows[0].origin_lon),
      alphabet: String(configResult.rows[0].alphabet || ''),
      gridLevels: configResult.rows[0].grid_levels
    };

    const branchSummaries = [];
    let successCount = 0;
    let failedCount = 0;

    for (const branchId of branchIds) {
      const startedAt = Date.now();
      try {
        const result = await transaction(async (client) => {
          await batchAllocationInternals.acquireBranchTerritoryLock(client, branchId);

          const tier2Generation = await batchAllocationInternals.ensureTier2MasterTilesAroundBranches(
            client,
            activePocketConfig,
            {
              branchIds: [branchId],
              levels: [levelMeters],
              force: true
            }
          );
          const forceRepairState = await batchAllocationInternals.clearBranchPersistentTerritoryState(
            client,
            branchId,
            levelMeters
          );
          const branchCoverage = await batchAllocationInternals.ensureBranchCatchmentCoverage(
            client,
            branchId,
            levelMeters
          );
          const allocationResult = await batchAllocationInternals.runCoreAndDonutAllocation(client, {
            branchId,
            levelMeters,
            latestJobId
          });

          await batchAllocationInternals.materializeClockwiseContiguousAllocation(
            client,
            branchId,
            allocationResult
          );

          const persistentTerritories = await batchAllocationInternals.persistBranchEmployeeTerritories(
            client,
            branchId,
            levelMeters
          );
          const twoWaySync = await batchAllocationInternals.runTwoWayAllocationSync(
            client,
            branchId,
            levelMeters,
            latestJobId
          );

          return {
            assignmentLevelMeters: Number(allocationResult?.assignmentLevelMeters || levelMeters),
            totalPockets: Number(allocationResult?.totalPockets || 0),
            totalCustomers: Number(allocationResult?.totalCustomers || 0),
            isolatedPocketAssignments: Number(allocationResult?.isolatedPocketAssignments || 0),
            tier2Generation,
            forceRepairState,
            branchCoverage,
            persistentTerritories,
            twoWaySync
          };
        });

        successCount += 1;
        branchSummaries.push({
          branch_id: branchId,
          status: 'success',
          duration_ms: Date.now() - startedAt,
          ...result
        });
      } catch (error) {
        failedCount += 1;
        branchSummaries.push({
          branch_id: branchId,
          status: 'failed',
          duration_ms: Date.now() - startedAt,
          error_code: String(error?.code || error?.errorCode || ''),
          error_message: String(error?.message || 'Branch reallocation failed')
        });
      }
    }

    res.json({
      generatedAt: new Date().toISOString(),
      levelMeters,
      totalBranches: branchIds.length,
      successCount,
      failedCount,
      latestJobId,
      branches: branchSummaries
    });
  })
);

module.exports = router;
