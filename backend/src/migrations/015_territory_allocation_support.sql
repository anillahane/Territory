-- Add territory allocation support for residence-seeded and bucket-aware allocation.

ALTER TABLE branch_employees
  ADD COLUMN IF NOT EXISTS residence_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS residence_lon DOUBLE PRECISION;

COMMENT ON COLUMN branch_employees.residence_lat IS
  'Employee home/residence latitude. Used as territory seed origin and falls back to branch coordinates when NULL.';

COMMENT ON COLUMN branch_employees.residence_lon IS
  'Employee home/residence longitude. Used as territory seed origin and falls back to branch coordinates when NULL.';

ALTER TABLE customer_pocket_mappings
  ADD COLUMN IF NOT EXISTS customer_bucket VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_customer_mappings_customer_bucket
  ON customer_pocket_mappings (customer_bucket)
  WHERE customer_bucket IS NOT NULL;

COMMENT ON COLUMN customer_pocket_mappings.customer_bucket IS
  'Customer grouping bucket (for example PREMIUM, SME, RETAIL) used by bucket-based territory allocation.';

ALTER TABLE employee_grid_cells
  ADD COLUMN IF NOT EXISTS bucket VARCHAR(100);

COMMENT ON COLUMN employee_grid_cells.bucket IS
  'Bucket label this grid cell was assigned under. NULL indicates continuous allocation.';

CREATE TABLE IF NOT EXISTS territory_allocation_runs (
  id BIGSERIAL PRIMARY KEY,
  branch_id VARCHAR(100) NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  scenario VARCHAR(20) NOT NULL CHECK (scenario IN ('continuous', 'bucket')),
  level_meters INTEGER NOT NULL DEFAULT 5000,
  employee_count INTEGER NOT NULL,
  pocket_count INTEGER NOT NULL,
  total_accounts INTEGER NOT NULL DEFAULT 0,
  bucket_count INTEGER,
  area_weight DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  account_weight DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  area_safeguard DOUBLE PRECISION NOT NULL DEFAULT 1.3,
  metrics JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_territory_allocation_runs_branch_created_at
  ON territory_allocation_runs (branch_id, created_at DESC);

COMMENT ON TABLE territory_allocation_runs IS
  'Audit log for territory allocation runs, including scenario parameters and per-run metrics.';
