-- Optimize customer mapping lookups for paged filtering and fuzzy customer searches.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_customer_mappings_job_id_verified
  ON customer_pocket_mappings (job_id);

CREATE INDEX IF NOT EXISTS idx_customer_mappings_pocket_id_verified
  ON customer_pocket_mappings (pocket_id);

CREATE INDEX IF NOT EXISTS idx_customer_mappings_nearest_branch_id_verified
  ON customer_pocket_mappings (nearest_branch_id);

CREATE INDEX IF NOT EXISTS idx_customer_mappings_existing_branch_id_verified
  ON customer_pocket_mappings (existing_branch_id)
  WHERE existing_branch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_customer_mappings_customer_id_trgm
  ON customer_pocket_mappings
  USING GIN (customer_id gin_trgm_ops);
