-- Add branch comparison fields for customer_pocket_mappings
ALTER TABLE customer_pocket_mappings
  ADD COLUMN IF NOT EXISTS uploaded_branch_code VARCHAR(50),
  ADD COLUMN IF NOT EXISTS existing_branch_id VARCHAR(20),
  ADD COLUMN IF NOT EXISTS distance_customer_to_existing_branch DECIMAL(10, 2);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_existing_branch'
      AND conrelid = 'customer_pocket_mappings'::regclass
  ) THEN
    ALTER TABLE customer_pocket_mappings
      ADD CONSTRAINT fk_existing_branch
      FOREIGN KEY (existing_branch_id)
      REFERENCES branches(id)
      ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_customer_mappings_existing_branch_id
  ON customer_pocket_mappings (existing_branch_id);
