CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'viewer',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT valid_user_role CHECK (role IN ('admin', 'editor', 'viewer'))
);

CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);

DROP TRIGGER IF EXISTS trigger_update_users_timestamp ON users;
CREATE TRIGGER trigger_update_users_timestamp
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS job_errors (
    id SERIAL PRIMARY KEY,
    job_id VARCHAR(50) NOT NULL,
    customer_id VARCHAR(255),
    batch_number INTEGER,
    error_message TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_job_errors_job FOREIGN KEY (job_id) REFERENCES jobs(job_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_job_errors_job_id ON job_errors (job_id);
CREATE INDEX IF NOT EXISTS idx_job_errors_customer_id ON job_errors (customer_id);

ALTER TABLE customer_pocket_mappings
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;

DROP TRIGGER IF EXISTS trigger_update_customer_mappings_timestamp ON customer_pocket_mappings;
CREATE TRIGGER trigger_update_customer_mappings_timestamp
    BEFORE UPDATE ON customer_pocket_mappings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

WITH ranked_duplicates AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY customer_id
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
    ) AS duplicate_rank
  FROM customer_pocket_mappings
),
deduped AS (
  DELETE FROM customer_pocket_mappings cpm
  USING ranked_duplicates rd
  WHERE cpm.id = rd.id
    AND rd.duplicate_rank > 1
  RETURNING cpm.id
)
SELECT COUNT(*) FROM deduped;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'uq_customer_pocket_mappings_customer_id'
      AND conrelid = 'customer_pocket_mappings'::regclass
  ) THEN
    ALTER TABLE customer_pocket_mappings
      ADD CONSTRAINT uq_customer_pocket_mappings_customer_id UNIQUE (customer_id);
  END IF;
END $$;
