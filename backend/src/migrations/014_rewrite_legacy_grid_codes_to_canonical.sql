BEGIN;

-- Rewrite legacy WebMercator-style pocket IDs (w...._p..._p...) to canonical hierarchical IDs.
-- Canonical regex: ^[0-9A-Z]{2}(?:-[0-9A-Z]{2}){0,4}$

CREATE OR REPLACE FUNCTION public.compute_canonical_pocket_code_m014(
  p_level_m INTEGER,
  p_center_lat DOUBLE PRECISION,
  p_center_lon DOUBLE PRECISION,
  p_origin_lat DOUBLE PRECISION,
  p_origin_lon DOUBLE PRECISION,
  p_alphabet TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_levels INTEGER[] := ARRAY[500000, 100000, 20000, 5000, 1000];
  v_level_index INTEGER;
  v_meters_per_degree_lat CONSTANT DOUBLE PRECISION := 111000;
  v_meters_per_degree_lon DOUBLE PRECISION;
  v_x DOUBLE PRECISION;
  v_y DOUBLE PRECISION;
  v_cumulative_x DOUBLE PRECISION := 0;
  v_cumulative_y DOUBLE PRECISION := 0;
  v_level_size INTEGER;
  v_row BIGINT;
  v_col BIGINT;
  v_norm_row INTEGER;
  v_norm_col INTEGER;
  v_parts TEXT[] := ARRAY[]::TEXT[];
BEGIN
  v_level_index := array_position(v_levels, p_level_m);
  IF v_level_index IS NULL THEN
    RETURN NULL;
  END IF;

  IF p_alphabet IS NULL OR length(p_alphabet) <> 30 THEN
    RETURN NULL;
  END IF;

  v_meters_per_degree_lon := v_meters_per_degree_lat * cos(radians(p_center_lat));
  IF v_meters_per_degree_lon = 0 THEN
    RETURN NULL;
  END IF;

  v_y := (p_center_lat - p_origin_lat) * v_meters_per_degree_lat;
  v_x := (p_center_lon - p_origin_lon) * v_meters_per_degree_lon;

  FOR i IN 1..v_level_index LOOP
    v_level_size := v_levels[i];
    v_col := floor((v_x - v_cumulative_x) / v_level_size);
    v_row := floor((v_y - v_cumulative_y) / v_level_size);

    v_cumulative_x := v_cumulative_x + (v_col * v_level_size);
    v_cumulative_y := v_cumulative_y + (v_row * v_level_size);

    v_norm_row := ((v_row % 30 + 30) % 30)::INTEGER;
    v_norm_col := ((v_col % 30 + 30) % 30)::INTEGER;

    v_parts := v_parts || (
      substr(p_alphabet, v_norm_row + 1, 1)
      || substr(p_alphabet, v_norm_col + 1, 1)
    );
  END LOOP;

  RETURN array_to_string(v_parts, '-');
END;
$$;

CREATE TEMP TABLE tmp_legacy_grid_code_map (
  legacy_code VARCHAR(50) PRIMARY KEY,
  canonical_code VARCHAR(20) NOT NULL
) ON COMMIT DROP;

INSERT INTO tmp_legacy_grid_code_map (legacy_code, canonical_code)
WITH config_row AS (
  SELECT
    COALESCE(MAX(CASE WHEN config.id = 1 THEN config.origin_lat END), 8.0)::DOUBLE PRECISION AS origin_lat,
    COALESCE(MAX(CASE WHEN config.id = 1 THEN config.origin_lon END), 68.0)::DOUBLE PRECISION AS origin_lon,
    COALESCE(
      MAX(CASE WHEN config.id = 1 THEN config.alphabet END),
      '0123456789ABCDEFGHJKLMNPQRSTUV'
    )::TEXT AS alphabet
  FROM config
),
legacy_grid_cells AS (
  SELECT
    gc.code::VARCHAR(50) AS legacy_code,
    gc.level_m::INTEGER AS level_m,
    ST_Y(ST_PointOnSurface(gc.geom))::DOUBLE PRECISION AS center_lat,
    ST_X(ST_PointOnSurface(gc.geom))::DOUBLE PRECISION AS center_lon
  FROM grid_cells gc
  WHERE gc.code ~* '^w[0-9a-f]+_[pn][0-9a-f]+_[pn][0-9a-f]+$'
    AND gc.level_m IN (500000, 100000, 20000, 5000, 1000)
    AND gc.geom IS NOT NULL
    AND NOT ST_IsEmpty(gc.geom)
)
SELECT
  legacy_grid_cells.legacy_code,
  public.compute_canonical_pocket_code_m014(
    legacy_grid_cells.level_m,
    legacy_grid_cells.center_lat,
    legacy_grid_cells.center_lon,
    config_row.origin_lat,
    config_row.origin_lon,
    config_row.alphabet
  )::VARCHAR(20) AS canonical_code
FROM legacy_grid_cells
CROSS JOIN config_row;

DELETE FROM tmp_legacy_grid_code_map
WHERE canonical_code IS NULL
   OR canonical_code !~ '^[0-9A-Z]{2}(?:-[0-9A-Z]{2}){0,4}$'
   OR canonical_code = legacy_code;

-- Ensure canonical master rows exist for every mapped legacy row.
INSERT INTO grid_cells (
  config_version,
  level_m,
  row_idx,
  col_idx,
  code,
  label_lat,
  label_lon,
  corners,
  created_at,
  geom,
  label_geom,
  min_lat,
  max_lat,
  min_lng,
  max_lng,
  allocated_employee_id,
  allocated_since
)
SELECT
  gc.config_version,
  gc.level_m,
  gc.row_idx,
  gc.col_idx,
  map.canonical_code,
  gc.label_lat,
  gc.label_lon,
  gc.corners,
  gc.created_at,
  gc.geom,
  gc.label_geom,
  gc.min_lat,
  gc.max_lat,
  gc.min_lng,
  gc.max_lng,
  gc.allocated_employee_id,
  gc.allocated_since
FROM grid_cells gc
JOIN tmp_legacy_grid_code_map map
  ON map.legacy_code = gc.code
ON CONFLICT (code)
DO NOTHING;

-- Upsert canonical branch territories first so employee_territories FK can remap safely.
INSERT INTO branch_territories (
  branch_id,
  grid_code,
  level_m,
  created_at,
  updated_at
)
SELECT
  src.branch_id,
  src.grid_code,
  src.level_m,
  src.created_at,
  CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT ON (bt.branch_id, map.canonical_code)
    bt.branch_id,
    map.canonical_code AS grid_code,
    bt.level_m,
    bt.created_at
  FROM branch_territories bt
  JOIN tmp_legacy_grid_code_map map
    ON map.legacy_code = bt.grid_code
  ORDER BY bt.branch_id, map.canonical_code, bt.updated_at DESC, bt.created_at DESC
) src
ON CONFLICT (branch_id, grid_code)
DO UPDATE SET
  level_m = EXCLUDED.level_m,
  updated_at = CURRENT_TIMESTAMP;

-- De-duplicate legacy rows that collapse to the same canonical (employee_id, grid_code) pair.
DELETE FROM employee_territories et
USING (
  SELECT ctid
  FROM (
    SELECT
      legacy.ctid,
      ROW_NUMBER() OVER (
        PARTITION BY legacy.employee_id, map.canonical_code
        ORDER BY legacy.updated_at DESC, legacy.created_at DESC, legacy.branch_id
      ) AS rn
    FROM employee_territories legacy
    JOIN tmp_legacy_grid_code_map map
      ON map.legacy_code = legacy.grid_code
  ) ranked
  WHERE ranked.rn > 1
) duplicates
WHERE et.ctid = duplicates.ctid;

-- De-duplicate legacy rows that collapse to the same canonical (branch_id, grid_code) pair.
DELETE FROM employee_territories et
USING (
  SELECT ctid
  FROM (
    SELECT
      legacy.ctid,
      ROW_NUMBER() OVER (
        PARTITION BY legacy.branch_id, map.canonical_code
        ORDER BY legacy.updated_at DESC, legacy.created_at DESC, legacy.employee_id
      ) AS rn
    FROM employee_territories legacy
    JOIN tmp_legacy_grid_code_map map
      ON map.legacy_code = legacy.grid_code
  ) ranked
  WHERE ranked.rn > 1
) duplicates
WHERE et.ctid = duplicates.ctid;

-- If canonical row already exists for a branch, preserve that row and copy assignment from legacy row.
UPDATE employee_territories canonical
SET
  branch_employee_id = legacy.branch_employee_id,
  employee_id = legacy.employee_id,
  updated_at = CURRENT_TIMESTAMP
FROM employee_territories legacy
JOIN tmp_legacy_grid_code_map map
  ON map.legacy_code = legacy.grid_code
WHERE canonical.branch_id = legacy.branch_id
  AND canonical.grid_code = map.canonical_code;

-- Remove legacy rows that would violate primary key (employee_id, grid_code) when remapped.
DELETE FROM employee_territories legacy
USING tmp_legacy_grid_code_map map, employee_territories canonical
WHERE legacy.grid_code = map.legacy_code
  AND canonical.employee_id = legacy.employee_id
  AND canonical.grid_code = map.canonical_code;

-- Remap remaining legacy employee territories to canonical IDs.
UPDATE employee_territories legacy
SET
  grid_code = map.canonical_code,
  updated_at = CURRENT_TIMESTAMP
FROM tmp_legacy_grid_code_map map
WHERE legacy.grid_code = map.legacy_code
  AND NOT EXISTS (
    SELECT 1
    FROM employee_territories canonical
    WHERE canonical.employee_id = legacy.employee_id
      AND canonical.grid_code = map.canonical_code
  )
  AND NOT EXISTS (
    SELECT 1
    FROM employee_territories canonical
    WHERE canonical.branch_id = legacy.branch_id
      AND canonical.grid_code = map.canonical_code
  );

-- Delete legacy duplicates that were merged or remapped.
DELETE FROM employee_territories legacy
USING tmp_legacy_grid_code_map map
WHERE legacy.grid_code = map.legacy_code;

-- Keep employee_id code synchronized with branch employee master after remap.
UPDATE employee_territories et
SET
  employee_id = be.employee_id,
  updated_at = CURRENT_TIMESTAMP
FROM branch_employees be
WHERE et.branch_employee_id = be.id
  AND et.branch_id = be.branch_id
  AND et.employee_id <> be.employee_id;

-- Remap legacy helper/materialized tables used by UI and analytics.
UPDATE employee_grid_cells egc
SET
  pocket_id = map.canonical_code,
  updated_at = CURRENT_TIMESTAMP
FROM tmp_legacy_grid_code_map map
WHERE egc.pocket_id = map.legacy_code;

UPDATE customer_pocket_mappings cpm
SET pocket_id = map.canonical_code
FROM tmp_legacy_grid_code_map map
WHERE cpm.pocket_id = map.legacy_code;

UPDATE branches b
SET
  pocket_id = map.canonical_code,
  updated_at = CURRENT_TIMESTAMP
FROM tmp_legacy_grid_code_map map
WHERE b.pocket_id = map.legacy_code;

-- Purge non-canonical IDs from dependent assignment tables.
DELETE FROM employee_territories
WHERE grid_code IS NULL
   OR btrim(grid_code) = ''
   OR grid_code !~ '^[0-9A-Z]{2}(?:-[0-9A-Z]{2}){0,4}$';

DELETE FROM branch_territories
WHERE grid_code IS NULL
   OR btrim(grid_code) = ''
   OR grid_code !~ '^[0-9A-Z]{2}(?:-[0-9A-Z]{2}){0,4}$';

DELETE FROM employee_grid_cells
WHERE pocket_id IS NULL
   OR btrim(pocket_id) = ''
   OR pocket_id !~ '^[0-9A-Z]{2}(?:-[0-9A-Z]{2}){0,4}$';

-- Cleanup any stale non-canonical values from reverse sync cache.
UPDATE branch_employees be
SET allocated_pockets = COALESCE(
  (
    SELECT jsonb_agg(value ORDER BY value)
    FROM jsonb_array_elements_text(COALESCE(be.allocated_pockets, '[]'::jsonb)) AS value
    WHERE value ~ '^[0-9A-Z]{2}(?:-[0-9A-Z]{2}){0,4}$'
  ),
  '[]'::jsonb
)
WHERE be.allocated_pockets IS DISTINCT FROM COALESCE(
  (
    SELECT jsonb_agg(value ORDER BY value)
    FROM jsonb_array_elements_text(COALESCE(be.allocated_pockets, '[]'::jsonb)) AS value
    WHERE value ~ '^[0-9A-Z]{2}(?:-[0-9A-Z]{2}){0,4}$'
  ),
  '[]'::jsonb
);

-- Now remove legacy/non-canonical master rows.
DELETE FROM grid_cells
WHERE code IS NULL
   OR btrim(code) = ''
   OR code !~ '^[0-9A-Z]{2}(?:-[0-9A-Z]{2}){0,4}$';

DROP FUNCTION public.compute_canonical_pocket_code_m014(
  INTEGER,
  DOUBLE PRECISION,
  DOUBLE PRECISION,
  DOUBLE PRECISION,
  DOUBLE PRECISION,
  TEXT
);

COMMIT;
