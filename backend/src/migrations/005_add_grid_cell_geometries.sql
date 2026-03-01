ALTER TABLE grid_cells
    ADD COLUMN IF NOT EXISTS geom GEOMETRY(POLYGON, 4326);

ALTER TABLE grid_cells
    ADD COLUMN IF NOT EXISTS label_geom GEOMETRY(POINT, 4326);

UPDATE grid_cells
SET
    geom = ST_SetSRID(
        ST_MakePolygon(
            ST_MakeLine(ARRAY[
                ST_MakePoint((corners->0->>1)::DOUBLE PRECISION, (corners->0->>0)::DOUBLE PRECISION),
                ST_MakePoint((corners->1->>1)::DOUBLE PRECISION, (corners->1->>0)::DOUBLE PRECISION),
                ST_MakePoint((corners->2->>1)::DOUBLE PRECISION, (corners->2->>0)::DOUBLE PRECISION),
                ST_MakePoint((corners->3->>1)::DOUBLE PRECISION, (corners->3->>0)::DOUBLE PRECISION),
                ST_MakePoint((corners->0->>1)::DOUBLE PRECISION, (corners->0->>0)::DOUBLE PRECISION)
            ])
        ),
        4326
    ),
    label_geom = ST_SetSRID(ST_MakePoint(label_lon, label_lat), 4326)
WHERE (geom IS NULL OR label_geom IS NULL)
  AND jsonb_array_length(corners) = 4;

CREATE INDEX IF NOT EXISTS idx_grid_cells_geom
    ON grid_cells USING GIST (geom);

CREATE INDEX IF NOT EXISTS idx_grid_cells_label_geom
    ON grid_cells USING GIST (label_geom);
