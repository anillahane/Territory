ALTER TABLE grid_cells
    DROP CONSTRAINT IF EXISTS chk_level_m_supported;

ALTER TABLE grid_cells
    ADD CONSTRAINT chk_level_m_supported
    CHECK (level_m IN (500000, 100000, 10000, 5000, 1000));

CREATE TABLE IF NOT EXISTS grid_tile_cache (
    id BIGSERIAL PRIMARY KEY,
    config_version INTEGER NOT NULL,
    level_m INTEGER NOT NULL,
    z INTEGER NOT NULL,
    x INTEGER NOT NULL,
    y INTEGER NOT NULL,
    tile BYTEA NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_tile_level_supported CHECK (level_m IN (500000, 100000, 10000, 5000, 1000)),
    CONSTRAINT uq_grid_tile_cache UNIQUE (config_version, level_m, z, x, y)
);

CREATE INDEX IF NOT EXISTS idx_grid_tile_cache_lookup
    ON grid_tile_cache (config_version, level_m, z, x, y);

