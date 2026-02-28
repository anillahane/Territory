-- Enable PostGIS extension
CREATE EXTENSION IF NOT EXISTS postgis;

-- Configuration table (singleton)
CREATE TABLE IF NOT EXISTS config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    origin_lat DOUBLE PRECISION NOT NULL DEFAULT 8.0,
    origin_lon DOUBLE PRECISION NOT NULL DEFAULT 68.0,
    alphabet VARCHAR(30) NOT NULL DEFAULT '0123456789ABCDEFGHJKLMNPQRSTUV',
    grid_levels JSONB NOT NULL DEFAULT '[500000, 100000, 20000, 5000, 1000]',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version INTEGER NOT NULL DEFAULT 1
);

-- Insert default configuration
INSERT INTO config (id, origin_lat, origin_lon, alphabet, grid_levels)
VALUES (1, 8.0, 68.0, '0123456789ABCDEFGHJKLMNPQRSTUV', '[500000, 100000, 20000, 5000, 1000]')
ON CONFLICT (id) DO NOTHING;

-- Branches table
CREATE TABLE IF NOT EXISTS branches (
    id VARCHAR(20) PRIMARY KEY,
    city VARCHAR(100),
    lat DOUBLE PRECISION NOT NULL,
    lon DOUBLE PRECISION NOT NULL,
    geom GEOGRAPHY(POINT, 4326),
    pocket_id VARCHAR(50),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT valid_lat CHECK (lat >= -90 AND lat <= 90),
    CONSTRAINT valid_lon CHECK (lon >= -180 AND lon <= 180)
);

-- Create spatial index on geography column
CREATE INDEX IF NOT EXISTS idx_branches_geom ON branches USING GIST (geom);

-- Create index on pocket_id for lookups
CREATE INDEX IF NOT EXISTS idx_branches_pocket_id ON branches (pocket_id);

-- Create index on lat/lon for fallback queries
CREATE INDEX IF NOT EXISTS idx_branches_lat_lon ON branches (lat, lon);

-- Function to automatically update geom column
CREATE OR REPLACE FUNCTION update_branch_geom()
RETURNS TRIGGER AS $$
BEGIN
    NEW.geom = ST_SetSRID(ST_MakePoint(NEW.lon, NEW.lat), 4326)::geography;
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to update geom on insert/update
CREATE TRIGGER trigger_update_branch_geom
    BEFORE INSERT OR UPDATE OF lat, lon ON branches
    FOR EACH ROW
    EXECUTE FUNCTION update_branch_geom();

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for config table
CREATE TRIGGER trigger_update_config_timestamp
    BEFORE UPDATE ON config
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Configuration audit table
CREATE TABLE IF NOT EXISTS config_audit (
    id SERIAL PRIMARY KEY,
    config_id INTEGER NOT NULL,
    origin_lat DOUBLE PRECISION NOT NULL,
    origin_lon DOUBLE PRECISION NOT NULL,
    alphabet VARCHAR(30) NOT NULL,
    grid_levels JSONB NOT NULL,
    changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    version INTEGER NOT NULL
);

-- Function to audit config changes
CREATE OR REPLACE FUNCTION audit_config_changes()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO config_audit (config_id, origin_lat, origin_lon, alphabet, grid_levels, version)
    VALUES (OLD.id, OLD.origin_lat, OLD.origin_lon, OLD.alphabet, OLD.grid_levels, OLD.version);
    
    NEW.version = OLD.version + 1;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for config audit
CREATE TRIGGER trigger_audit_config
    BEFORE UPDATE ON config
    FOR EACH ROW
    EXECUTE FUNCTION audit_config_changes();

-- Job queue table (for batch processing)
CREATE TABLE IF NOT EXISTS jobs (
    id SERIAL PRIMARY KEY,
    job_id VARCHAR(50) UNIQUE NOT NULL,
    type VARCHAR(50) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    progress INTEGER DEFAULT 0,
    total INTEGER DEFAULT 0,
    result_url TEXT,
    error TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);

-- Index on job_id for lookups
CREATE INDEX IF NOT EXISTS idx_jobs_job_id ON jobs (job_id);

-- Index on status for filtering
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs (status);
