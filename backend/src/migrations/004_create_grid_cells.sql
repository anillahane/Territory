-- Precomputed dashboard grid cells (500 km and 100 km)
CREATE TABLE IF NOT EXISTS grid_cells (
    id BIGSERIAL PRIMARY KEY,
    config_version INTEGER NOT NULL,
    level_m INTEGER NOT NULL,
    row_idx INTEGER NOT NULL,
    col_idx INTEGER NOT NULL,
    code VARCHAR(20) NOT NULL,
    label_lat DOUBLE PRECISION NOT NULL,
    label_lon DOUBLE PRECISION NOT NULL,
    corners JSONB NOT NULL,
    geom GEOMETRY(POLYGON, 4326),
    label_geom GEOMETRY(POINT, 4326),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_level_m_supported CHECK (level_m IN (500000, 100000, 10000, 5000, 1000)),
    CONSTRAINT uq_grid_cells UNIQUE (config_version, level_m, row_idx, col_idx)
);

CREATE INDEX IF NOT EXISTS idx_grid_cells_config_level
    ON grid_cells (config_version, level_m);

CREATE INDEX IF NOT EXISTS idx_grid_cells_code
    ON grid_cells (code);

CREATE INDEX IF NOT EXISTS idx_grid_cells_geom
    ON grid_cells USING GIST (geom);

CREATE INDEX IF NOT EXISTS idx_grid_cells_label_geom
    ON grid_cells USING GIST (label_geom);
