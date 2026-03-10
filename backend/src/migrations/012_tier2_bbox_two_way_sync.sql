BEGIN;

-- grid_cells: fast bbox columns + one-way allocation state
ALTER TABLE grid_cells
  ADD COLUMN IF NOT EXISTS min_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS max_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS min_lng DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS max_lng DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS allocated_employee_id INTEGER,
  ADD COLUMN IF NOT EXISTS allocated_since TIMESTAMP;

-- branch_employees: reverse mirror fields
ALTER TABLE branch_employees
  ADD COLUMN IF NOT EXISTS allocated_pockets JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS allocated_customer_count INTEGER NOT NULL DEFAULT 0;

-- FK from grid_cells to employee master
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_grid_cells_allocated_employee_id'
  ) THEN
    ALTER TABLE grid_cells
      ADD CONSTRAINT fk_grid_cells_allocated_employee_id
      FOREIGN KEY (allocated_employee_id)
      REFERENCES branch_employees(id)
      ON DELETE SET NULL;
  END IF;
END
$$;

-- Backfill bbox values from existing geometry
UPDATE grid_cells
SET
  min_lng = ST_XMin(geom),
  min_lat = ST_YMin(geom),
  max_lng = ST_XMax(geom),
  max_lat = ST_YMax(geom)
WHERE geom IS NOT NULL
  AND NOT ST_IsEmpty(geom)
  AND (
    min_lng IS NULL
    OR min_lat IS NULL
    OR max_lng IS NULL
    OR max_lat IS NULL
  );

-- B-tree indexes for ultra-fast bbox predicates
CREATE INDEX IF NOT EXISTS idx_grid_cells_min_lat ON grid_cells (min_lat);
CREATE INDEX IF NOT EXISTS idx_grid_cells_max_lat ON grid_cells (max_lat);
CREATE INDEX IF NOT EXISTS idx_grid_cells_min_lng ON grid_cells (min_lng);
CREATE INDEX IF NOT EXISTS idx_grid_cells_max_lng ON grid_cells (max_lng);

-- Sync helpers
CREATE INDEX IF NOT EXISTS idx_grid_cells_allocated_employee_id
  ON grid_cells (allocated_employee_id);

CREATE INDEX IF NOT EXISTS idx_cpm_job_branch_lat_lng
  ON customer_pocket_mappings (job_id, nearest_branch_id, customer_lat, customer_lon);

COMMIT;
