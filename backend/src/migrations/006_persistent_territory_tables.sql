-- Ensure grid code can be referenced by foreign keys.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT code
      FROM grid_cells
      WHERE code IS NOT NULL
        AND btrim(code) <> ''
      GROUP BY code
      HAVING COUNT(*) > 1
    ) duplicate_codes
  ) THEN
    RAISE EXCEPTION
      'Cannot create persistent territory FK: grid_cells.code contains duplicates';
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_grid_cells_code_reference
  ON grid_cells (code);

CREATE TABLE IF NOT EXISTS branch_territories (
  branch_id VARCHAR(20) NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  grid_code VARCHAR(20) NOT NULL REFERENCES grid_cells(code) ON DELETE RESTRICT,
  level_m INTEGER NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_branch_territories PRIMARY KEY (branch_id, grid_code),
  CONSTRAINT chk_branch_territories_level_m CHECK (level_m > 0)
);

CREATE INDEX IF NOT EXISTS idx_branch_territories_branch_level
  ON branch_territories (branch_id, level_m);

CREATE INDEX IF NOT EXISTS idx_branch_territories_grid_code
  ON branch_territories (grid_code);

DROP TRIGGER IF EXISTS trigger_update_branch_territories_timestamp ON branch_territories;
CREATE TRIGGER trigger_update_branch_territories_timestamp
  BEFORE UPDATE ON branch_territories
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS employee_territories (
  employee_id VARCHAR(50) NOT NULL,
  branch_id VARCHAR(20) NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  grid_code VARCHAR(20) NOT NULL REFERENCES grid_cells(code) ON DELETE RESTRICT,
  -- Phase 1: add as nullable (for existing legacy data)
  branch_employee_id INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_employee_territories PRIMARY KEY (employee_id, grid_code),
  CONSTRAINT uq_employee_territories_branch_grid UNIQUE (branch_id, grid_code),
  CONSTRAINT fk_employee_territories_branch_grid
    FOREIGN KEY (branch_id, grid_code)
    REFERENCES branch_territories(branch_id, grid_code)
    ON DELETE CASCADE
);

-- Phase 1 (idempotent): ensure column exists and is nullable first.
ALTER TABLE employee_territories
  ADD COLUMN IF NOT EXISTS branch_employee_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_employee_territories_branch
  ON employee_territories (branch_id);

CREATE INDEX IF NOT EXISTS idx_employee_territories_grid_code
  ON employee_territories (grid_code);

CREATE INDEX IF NOT EXISTS idx_employee_territories_branch_employee
  ON employee_territories (branch_employee_id);

DROP TRIGGER IF EXISTS trigger_update_employee_territories_timestamp ON employee_territories;
CREATE TRIGGER trigger_update_employee_territories_timestamp
  BEFORE UPDATE ON employee_territories
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Backfill from existing employee_grid_cells so existing assignments remain available.
WITH source_branch_grids AS (
  SELECT DISTINCT
    egc.branch_id,
    egc.pocket_id::varchar AS grid_code,
    COALESCE(gc.level_m, 1000)::int AS level_m
  FROM employee_grid_cells egc
  LEFT JOIN grid_cells gc
    ON gc.code = egc.pocket_id
  WHERE egc.pocket_id IS NOT NULL
    AND btrim(egc.pocket_id) <> ''
    AND gc.code IS NOT NULL
)
INSERT INTO branch_territories (
  branch_id,
  grid_code,
  level_m
)
SELECT
  source_branch_grids.branch_id,
  source_branch_grids.grid_code,
  source_branch_grids.level_m
FROM source_branch_grids
ON CONFLICT (branch_id, grid_code)
DO UPDATE SET
  level_m = EXCLUDED.level_m,
  updated_at = CURRENT_TIMESTAMP;

-- --- ORIGINAL BACKUP ---
-- WITH source_employee_grids AS (
--   SELECT DISTINCT
--     be.id::int AS branch_employee_id,
--     be.employee_id::varchar AS employee_id,
--     egc.branch_id,
--     egc.pocket_id::varchar AS grid_code
--   FROM employee_grid_cells egc
--   JOIN branch_territories bt
--     ON bt.branch_id = egc.branch_id
--    AND bt.grid_code = egc.pocket_id::varchar
--   JOIN branch_employees be
--     ON be.branch_id = egc.branch_id
--    AND (
--      be.employee_id = egc.assigned_employee_id::varchar
--      OR be.id::text = egc.assigned_employee_id::text
--    )
--   WHERE egc.assigned_employee_id IS NOT NULL
--     AND btrim(egc.assigned_employee_id) <> ''
--     AND egc.pocket_id IS NOT NULL
--     AND btrim(egc.pocket_id) <> ''
-- )
-- INSERT INTO employee_territories (
--   branch_employee_id,
--   employee_id,
--   branch_id,
--   grid_code
-- )
-- SELECT
--   source_employee_grids.branch_employee_id,
--   source_employee_grids.employee_id,
--   source_employee_grids.branch_id,
--   source_employee_grids.grid_code
-- FROM source_employee_grids
-- ON CONFLICT (branch_id, grid_code)
-- DO UPDATE SET
--   branch_employee_id = EXCLUDED.branch_employee_id,
--   employee_id = EXCLUDED.employee_id,
--   updated_at = CURRENT_TIMESTAMP;

WITH raw_source_employee_grids AS (
  SELECT
    be.id::int AS branch_employee_id,
    be.employee_id::varchar AS employee_id,
    egc.branch_id,
    egc.pocket_id::varchar AS grid_code,
    egc.updated_at,
    egc.created_at
  FROM employee_grid_cells egc
  JOIN branch_territories bt
    ON bt.branch_id = egc.branch_id
   AND bt.grid_code = egc.pocket_id::varchar
  JOIN branch_employees be
    ON be.branch_id = egc.branch_id
   AND (
     be.employee_id = egc.assigned_employee_id::varchar
     OR be.id::text = egc.assigned_employee_id::text
   )
  WHERE egc.assigned_employee_id IS NOT NULL
    AND btrim(egc.assigned_employee_id) <> ''
    AND egc.pocket_id IS NOT NULL
    AND btrim(egc.pocket_id) <> ''
),
source_employee_grids AS (
  SELECT
    ranked.branch_employee_id,
    ranked.employee_id,
    ranked.branch_id,
    ranked.grid_code
  FROM (
    SELECT
      raw_source_employee_grids.*,
      ROW_NUMBER() OVER (
        PARTITION BY raw_source_employee_grids.branch_id, raw_source_employee_grids.grid_code
        ORDER BY
          raw_source_employee_grids.updated_at DESC NULLS LAST,
          raw_source_employee_grids.created_at DESC NULLS LAST,
          raw_source_employee_grids.branch_employee_id
      ) AS row_priority
    FROM raw_source_employee_grids
  ) ranked
  WHERE ranked.row_priority = 1
)
INSERT INTO employee_territories (
  branch_employee_id,
  employee_id,
  branch_id,
  grid_code
)
SELECT
  source_employee_grids.branch_employee_id,
  source_employee_grids.employee_id,
  source_employee_grids.branch_id,
  source_employee_grids.grid_code
FROM source_employee_grids
ON CONFLICT (branch_id, grid_code)
DO UPDATE SET
  branch_employee_id = EXCLUDED.branch_employee_id,
  employee_id = EXCLUDED.employee_id,
  updated_at = CURRENT_TIMESTAMP;

-- Phase 2: backfill branch_employee_id for any existing legacy rows.
UPDATE employee_territories et
SET branch_employee_id = be.id
FROM branch_employees be
WHERE et.branch_employee_id IS NULL
  AND et.branch_id = be.branch_id
  AND (
    (et.employee_id IS NOT NULL
      AND btrim(et.employee_id::text) <> ''
      AND be.employee_id = et.employee_id::text)
    OR be.id::text = et.employee_id::text
  );

-- Phase 3: clean orphan rows that still cannot resolve branch_employee_id.
DELETE FROM employee_territories
WHERE branch_employee_id IS NULL;

-- Keep legacy employee_id in sync with employee master code.
UPDATE employee_territories et
SET employee_id = be.employee_id
FROM branch_employees be
WHERE be.id = et.branch_employee_id
  AND et.branch_id = be.branch_id
  AND (
    et.employee_id IS NULL
    OR btrim(et.employee_id::text) = ''
    OR et.employee_id::text <> be.employee_id
  );

-- FK to branch_employees.id (idempotent).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_employee_territories_branch_employee_id'
  ) THEN
    ALTER TABLE employee_territories
      ADD CONSTRAINT fk_employee_territories_branch_employee_id
      FOREIGN KEY (branch_employee_id)
      REFERENCES branch_employees(id)
      ON DELETE CASCADE;
  END IF;
END
$$;

-- Phase 4: enforce NOT NULL after backfill + orphan cleanup.
ALTER TABLE employee_territories
  ALTER COLUMN branch_employee_id SET NOT NULL;
