BEGIN;

-- Ensure grid_cells level constraint supports 20km Tier-2 generation.
-- Keep 10000 for legacy compatibility with historical data, if present.
ALTER TABLE grid_cells
  DROP CONSTRAINT IF EXISTS chk_level_m_supported;

ALTER TABLE grid_cells
  ADD CONSTRAINT chk_level_m_supported
  CHECK (
    level_m = ANY (ARRAY[500000, 100000, 20000, 10000, 5000, 1000])
  );

COMMIT;
