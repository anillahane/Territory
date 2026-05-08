-- Backfill customer-to-branch distances from actual branch coordinates and
-- repair legacy employee grid level metadata so 1km and 5km allocations can coexist.

WITH pocket_centers AS (
  SELECT
    gc.code,
    COALESCE(gc.label_lat, ST_Y(ST_PointOnSurface(gc.geom)))::double precision AS center_lat,
    COALESCE(gc.label_lon, ST_X(ST_PointOnSurface(gc.geom)))::double precision AS center_lon
  FROM grid_cells gc
  WHERE gc.code IS NOT NULL
    AND btrim(gc.code) <> ''
    AND (
      (gc.label_lat IS NOT NULL AND gc.label_lon IS NOT NULL)
      OR (gc.geom IS NOT NULL AND NOT ST_IsEmpty(gc.geom))
    )
),
recomputed_mapping_distances AS (
  SELECT
    cpm.id,
    ROUND(
      ST_Distance(
        ST_SetSRID(ST_MakePoint(cpm.customer_lon, cpm.customer_lat), 4326)::geography,
        ST_SetSRID(ST_MakePoint(b.lon, b.lat), 4326)::geography
      )::numeric,
      2
    ) AS distance_customer_to_branch,
    ROUND(
      COALESCE(
        ST_Distance(
          ST_SetSRID(ST_MakePoint(pc.center_lon, pc.center_lat), 4326)::geography,
          ST_SetSRID(ST_MakePoint(b.lon, b.lat), 4326)::geography
        ),
        ST_Distance(
          ST_SetSRID(ST_MakePoint(cpm.customer_lon, cpm.customer_lat), 4326)::geography,
          ST_SetSRID(ST_MakePoint(b.lon, b.lat), 4326)::geography
        )
      )::numeric,
      2
    ) AS distance_pocket_to_branch
  FROM customer_pocket_mappings cpm
  JOIN branches b
    ON b.id = cpm.nearest_branch_id
  LEFT JOIN pocket_centers pc
    ON pc.code = cpm.pocket_id
  WHERE b.lat IS NOT NULL
    AND b.lon IS NOT NULL
)
UPDATE customer_pocket_mappings cpm
SET
  distance_customer_to_branch = recomputed_mapping_distances.distance_customer_to_branch,
  distance_pocket_to_branch = recomputed_mapping_distances.distance_pocket_to_branch
FROM recomputed_mapping_distances
WHERE cpm.id = recomputed_mapping_distances.id
  AND (
    cpm.distance_customer_to_branch IS DISTINCT FROM recomputed_mapping_distances.distance_customer_to_branch
    OR cpm.distance_pocket_to_branch IS DISTINCT FROM recomputed_mapping_distances.distance_pocket_to_branch
  );

WITH inferred_employee_grid_levels AS (
  SELECT
    egc.id,
    COALESCE(
      bt.level_m,
      gc.level_m,
      CASE array_length(string_to_array(egc.pocket_id, '-'), 1)
        WHEN 5 THEN 1000
        WHEN 4 THEN 5000
        WHEN 3 THEN 20000
        WHEN 2 THEN 100000
        WHEN 1 THEN 500000
        ELSE NULL
      END
    ) AS inferred_level_m
  FROM employee_grid_cells egc
  LEFT JOIN branch_territories bt
    ON bt.branch_id = egc.branch_id
   AND bt.grid_code = egc.pocket_id::varchar
  LEFT JOIN grid_cells gc
    ON gc.code = egc.pocket_id::varchar
  WHERE egc.pocket_id IS NOT NULL
    AND btrim(egc.pocket_id) <> ''
)
UPDATE employee_grid_cells egc
SET level_km = GREATEST(
  1,
  ROUND((inferred_employee_grid_levels.inferred_level_m::numeric / 1000.0))::integer
)
FROM inferred_employee_grid_levels
WHERE egc.id = inferred_employee_grid_levels.id
  AND inferred_employee_grid_levels.inferred_level_m IS NOT NULL
  AND COALESCE(egc.level_km, 1) <> GREATEST(
    1,
    ROUND((inferred_employee_grid_levels.inferred_level_m::numeric / 1000.0))::integer
  );

CREATE INDEX IF NOT EXISTS idx_customer_mappings_job_existing_branch
  ON customer_pocket_mappings (job_id, existing_branch_id)
  WHERE existing_branch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_customer_mappings_job_nearest_branch
  ON customer_pocket_mappings (job_id, nearest_branch_id);
