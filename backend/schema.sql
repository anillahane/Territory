-- Basic database schema for Territory application
-- This is a minimal schema to get started

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Configuration table
CREATE TABLE IF NOT EXISTS config (
    id SERIAL PRIMARY KEY,
    origin_lat DECIMAL(10, 7) NOT NULL DEFAULT 8.0,
    origin_lon DECIMAL(10, 7) NOT NULL DEFAULT 68.0,
    alphabet VARCHAR(30) NOT NULL DEFAULT 'ABCDEFGHIJKLMNOPQRSTUVWXYZ1234',
    grid_500km_size INTEGER NOT NULL DEFAULT 500,
    grid_100km_size INTEGER NOT NULL DEFAULT 100,
    grid_20km_size INTEGER NOT NULL DEFAULT 20,
    grid_5km_size INTEGER NOT NULL DEFAULT 5,
    grid_1km_size INTEGER NOT NULL DEFAULT 1,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert default configuration if not exists
INSERT INTO config (id, origin_lat, origin_lon, alphabet)
VALUES (1, 8.0, 68.0, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ1234')
ON CONFLICT (id) DO NOTHING;

-- Configuration audit table
CREATE TABLE IF NOT EXISTS config_audit (
    id SERIAL PRIMARY KEY,
    changed_by VARCHAR(255),
    changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    old_values JSONB,
    new_values JSONB,
    change_type VARCHAR(50)
);

-- Branches table
CREATE TABLE IF NOT EXISTS branches (
    id SERIAL PRIMARY KEY,
    branch_code VARCHAR(50) UNIQUE NOT NULL,
    branch_name VARCHAR(255) NOT NULL,
    latitude DECIMAL(10, 7) NOT NULL,
    longitude DECIMAL(10, 7) NOT NULL,
    pocket_id VARCHAR(255),
    address TEXT,
    city VARCHAR(100),
    state VARCHAR(100),
    country VARCHAR(100) DEFAULT 'India',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Customer pocket mappings table
CREATE TABLE IF NOT EXISTS customer_pocket_mappings (
    id SERIAL PRIMARY KEY,
    customer_code VARCHAR(50) NOT NULL,
    customer_name VARCHAR(255),
    latitude DECIMAL(10, 7) NOT NULL,
    longitude DECIMAL(10, 7) NOT NULL,
    pocket_id VARCHAR(255),
    distance_to_pocket DECIMAL(10, 3),
    nearest_branch_code VARCHAR(50),
    nearest_branch_name VARCHAR(255),
    distance_to_branch DECIMAL(10, 3),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Batch processing jobs table
CREATE TABLE IF NOT EXISTS jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    type VARCHAR(50) NOT NULL,
    status VARCHAR(50) NOT NULL,
    input_file_path TEXT,
    output_file_path TEXT,
    total_rows INTEGER,
    processed_rows INTEGER,
    error_message TEXT,
    metadata JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);

-- Python batch jobs table
CREATE TABLE IF NOT EXISTS python_batch_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    status VARCHAR(50) NOT NULL,
    input_file TEXT,
    output_file TEXT,
    total_rows INTEGER,
    processed_rows INTEGER DEFAULT 0,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_branches_pocket_id ON branches(pocket_id);
CREATE INDEX IF NOT EXISTS idx_branches_location ON branches(latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_customer_pocket_mappings_pocket_id ON customer_pocket_mappings(pocket_id);
CREATE INDEX IF NOT EXISTS idx_customer_pocket_mappings_customer ON customer_pocket_mappings(customer_code);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_python_batch_jobs_status ON python_batch_jobs(status);