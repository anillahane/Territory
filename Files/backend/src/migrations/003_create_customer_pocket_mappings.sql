-- Create customer_pocket_mappings table
CREATE TABLE IF NOT EXISTS customer_pocket_mappings (
    id SERIAL PRIMARY KEY,
    job_id VARCHAR(50) NOT NULL,
    customer_id VARCHAR(255) NOT NULL,
    customer_lat DECIMAL(10, 8) NOT NULL,
    customer_lon DECIMAL(11, 8) NOT NULL,
    pocket_id VARCHAR(50) NOT NULL,
    distance_customer_to_pocket DECIMAL(10, 2) NOT NULL,
    nearest_branch_id VARCHAR(20) NOT NULL,
    distance_pocket_to_branch DECIMAL(10, 2) NOT NULL,
    distance_customer_to_branch DECIMAL(10, 2) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    
    -- Foreign key constraints
    CONSTRAINT fk_job FOREIGN KEY (job_id) REFERENCES jobs(job_id) ON DELETE CASCADE,
    CONSTRAINT fk_branch FOREIGN KEY (nearest_branch_id) REFERENCES branches(id) ON DELETE RESTRICT,
    
    -- Validation constraints
    CONSTRAINT valid_customer_lat CHECK (customer_lat >= -90 AND customer_lat <= 90),
    CONSTRAINT valid_customer_lon CHECK (customer_lon >= -180 AND customer_lon <= 180),
    CONSTRAINT valid_distances CHECK (
        distance_customer_to_pocket >= 0 AND
        distance_pocket_to_branch >= 0 AND
        distance_customer_to_branch >= 0
    )
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_customer_mappings_job_id ON customer_pocket_mappings (job_id);
CREATE INDEX IF NOT EXISTS idx_customer_mappings_customer_id ON customer_pocket_mappings (customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_mappings_pocket_id ON customer_pocket_mappings (pocket_id);
CREATE INDEX IF NOT EXISTS idx_customer_mappings_created_at ON customer_pocket_mappings (created_at);
CREATE INDEX IF NOT EXISTS idx_customer_mappings_branch_id ON customer_pocket_mappings (nearest_branch_id);

-- Create composite index for common query patterns
CREATE INDEX IF NOT EXISTS idx_customer_mappings_job_pocket ON customer_pocket_mappings (job_id, pocket_id);

