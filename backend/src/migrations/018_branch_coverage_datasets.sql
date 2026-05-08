CREATE TABLE IF NOT EXISTS branch_coverage_datasets (
  branch_id VARCHAR(20) NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  basis_type VARCHAR(40) NOT NULL,
  source_mode VARCHAR(40) NOT NULL,
  coverage_style VARCHAR(20) NOT NULL DEFAULT 'overlap',
  source_job_id VARCHAR(50),
  status VARCHAR(20) NOT NULL DEFAULT 'ready',
  error_message TEXT,
  native_customer_count INTEGER NOT NULL DEFAULT 0,
  catchment_customer_count INTEGER NOT NULL DEFAULT 0,
  total_customer_count INTEGER NOT NULL DEFAULT 0,
  farthest_customer_distance_km NUMERIC(12, 2) NOT NULL DEFAULT 0,
  territory_geojson JSONB NOT NULL DEFAULT '{"type":"FeatureCollection","features":[]}'::jsonb,
  territory_customers_geojson JSONB NOT NULL DEFAULT '{"type":"FeatureCollection","features":[]}'::jsonb,
  original_customers_geojson JSONB NOT NULL DEFAULT '{"type":"FeatureCollection","features":[]}'::jsonb,
  branch_feature_geojson JSONB NOT NULL DEFAULT '{"type":"FeatureCollection","features":[]}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  computed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_branch_coverage_datasets PRIMARY KEY (branch_id, basis_type),
  CONSTRAINT chk_branch_coverage_basis_type CHECK (
    basis_type IN (
      'current_ownership',
      'closest_branch',
      'strongest_presence',
      'mutually_exclusive'
    )
  ),
  CONSTRAINT chk_branch_coverage_source_mode CHECK (
    source_mode IN (
      'existing_customers',
      'nearest_pockets',
      'customer_availability'
    )
  ),
  CONSTRAINT chk_branch_coverage_style CHECK (
    coverage_style IN ('overlap', 'exclusive')
  ),
  CONSTRAINT chk_branch_coverage_status CHECK (
    status IN ('ready', 'failed')
  )
);

CREATE INDEX IF NOT EXISTS idx_branch_coverage_datasets_basis
  ON branch_coverage_datasets (basis_type);

CREATE INDEX IF NOT EXISTS idx_branch_coverage_datasets_status
  ON branch_coverage_datasets (status);

CREATE INDEX IF NOT EXISTS idx_branch_coverage_datasets_source_job
  ON branch_coverage_datasets (source_job_id);

DROP TRIGGER IF EXISTS trigger_update_branch_coverage_datasets_timestamp ON branch_coverage_datasets;
CREATE TRIGGER trigger_update_branch_coverage_datasets_timestamp
  BEFORE UPDATE ON branch_coverage_datasets
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
