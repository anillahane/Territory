-- Backfill persistent 40km branch catchments at 5km resolution.
-- This ensures every branch has pre-identified allocatable grid pockets.

WITH config_version AS (
  SELECT COALESCE(MAX(version), 1)::int AS value
  FROM config
  WHERE id = 1
),
branch_geom AS (
  SELECT
    branches.id AS branch_id,
    COALESCE(
      branches.geom::geometry,
      ST_SetSRID(ST_MakePoint(branches.lon, branches.lat), 4326)
    ) AS geom
  FROM branches
),
catchment AS (
  SELECT
    branch_geom.branch_id,
    ST_Buffer(branch_geom.geom::geography, 40000)::geometry AS geom
  FROM branch_geom
),
generated_cells AS (
  SELECT
    catchment.branch_id,
    generated.i::int AS col_idx,
    generated.j::int AS row_idx,
    ST_Transform(generated.geom, 4326)::geometry(POLYGON, 4326) AS geom
  FROM catchment
  CROSS JOIN LATERAL ST_SquareGrid(
    5000,
    ST_Transform(catchment.geom, 3857)
  ) AS generated
),
unique_generated AS (
  SELECT DISTINCT
    generated_cells.row_idx,
    generated_cells.col_idx,
    generated_cells.geom
  FROM generated_cells
),
missing_master AS (
  SELECT
    unique_generated.row_idx,
    unique_generated.col_idx,
    unique_generated.geom
  FROM unique_generated
  WHERE NOT EXISTS (
    SELECT 1
    FROM grid_cells existing
    WHERE existing.level_m = 5000
      AND existing.geom IS NOT NULL
      AND existing.geom && unique_generated.geom
      AND ST_Equals(existing.geom, unique_generated.geom)
  )
),
inserted_master AS (
  INSERT INTO grid_cells (
    config_version,
    level_m,
    row_idx,
    col_idx,
    code,
    label_lat,
    label_lon,
    corners,
    geom,
    label_geom
  )
  SELECT
    config_version.value AS config_version,
    5000 AS level_m,
    missing_master.row_idx,
    missing_master.col_idx,
    (
      'w' || to_hex(5000::bigint)
      || '_' || CASE WHEN missing_master.row_idx < 0 THEN 'n' ELSE 'p' END || to_hex(abs(missing_master.row_idx)::bigint)
      || '_' || CASE WHEN missing_master.col_idx < 0 THEN 'n' ELSE 'p' END || to_hex(abs(missing_master.col_idx)::bigint)
    )::varchar(20) AS code,
    ST_Y(ST_PointOnSurface(missing_master.geom)) AS label_lat,
    ST_X(ST_PointOnSurface(missing_master.geom)) AS label_lon,
    jsonb_build_object(
      'sw', jsonb_build_object(
        'lat', ST_Y(ST_PointN(ST_ExteriorRing(missing_master.geom), 1)),
        'lon', ST_X(ST_PointN(ST_ExteriorRing(missing_master.geom), 1))
      ),
      'se', jsonb_build_object(
        'lat', ST_Y(ST_PointN(ST_ExteriorRing(missing_master.geom), 2)),
        'lon', ST_X(ST_PointN(ST_ExteriorRing(missing_master.geom), 2))
      ),
      'ne', jsonb_build_object(
        'lat', ST_Y(ST_PointN(ST_ExteriorRing(missing_master.geom), 3)),
        'lon', ST_X(ST_PointN(ST_ExteriorRing(missing_master.geom), 3))
      ),
      'nw', jsonb_build_object(
        'lat', ST_Y(ST_PointN(ST_ExteriorRing(missing_master.geom), 4)),
        'lon', ST_X(ST_PointN(ST_ExteriorRing(missing_master.geom), 4))
      )
    ) AS corners,
    missing_master.geom,
    ST_PointOnSurface(missing_master.geom)::geometry(POINT, 4326) AS label_geom
  FROM missing_master
  CROSS JOIN config_version
  ON CONFLICT (code)
  DO UPDATE SET
    level_m = EXCLUDED.level_m,
    row_idx = EXCLUDED.row_idx,
    col_idx = EXCLUDED.col_idx,
    label_lat = EXCLUDED.label_lat,
    label_lon = EXCLUDED.label_lon,
    corners = EXCLUDED.corners,
    geom = EXCLUDED.geom,
    label_geom = EXCLUDED.label_geom
  RETURNING 1
),
catchment_master AS (
  SELECT DISTINCT
    catchment.branch_id,
    grid_cells.code::varchar AS grid_code
  FROM catchment
  JOIN grid_cells
    ON grid_cells.level_m = 5000
   AND grid_cells.geom IS NOT NULL
   AND NOT ST_IsEmpty(grid_cells.geom)
   AND ST_Intersects(grid_cells.geom, catchment.geom)
),
removed_outside AS (
  DELETE FROM branch_territories bt
  WHERE bt.level_m = 5000
    AND NOT EXISTS (
      SELECT 1
      FROM catchment_master
      WHERE catchment_master.branch_id = bt.branch_id
        AND catchment_master.grid_code = bt.grid_code
    )
  RETURNING 1
),
upserted_branch AS (
  INSERT INTO branch_territories (
    branch_id,
    grid_code,
    level_m
  )
  SELECT
    catchment_master.branch_id,
    catchment_master.grid_code,
    5000 AS level_m
  FROM catchment_master
  ON CONFLICT (branch_id, grid_code)
  DO UPDATE SET
    level_m = EXCLUDED.level_m,
    updated_at = CURRENT_TIMESTAMP
  RETURNING 1
)
SELECT
  (SELECT COUNT(*)::int FROM inserted_master) AS inserted_master_rows,
  (SELECT COUNT(*)::int FROM removed_outside) AS removed_outside_rows,
  (SELECT COUNT(*)::int FROM upserted_branch) AS upserted_branch_rows;
