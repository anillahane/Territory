-- Branch-level employee roster for territory assignment
CREATE TABLE IF NOT EXISTS branch_employees (
    id SERIAL PRIMARY KEY,
    branch_id VARCHAR(20) NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    employee_id VARCHAR(50) NOT NULL,
    employee_name VARCHAR(120),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_branch_employee UNIQUE (branch_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_branch_employees_branch_active
  ON branch_employees (branch_id, is_active);

DROP TRIGGER IF EXISTS trigger_update_branch_employees_timestamp ON branch_employees;
CREATE TRIGGER trigger_update_branch_employees_timestamp
  BEFORE UPDATE ON branch_employees
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 1km/5km branch pocket storage dedicated to employee territory assignment.
-- This table is intentionally separate from legacy global grid_cells schema.
CREATE TABLE IF NOT EXISTS employee_grid_cells (
    id BIGSERIAL PRIMARY KEY,
    branch_id VARCHAR(20) NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    pocket_id VARCHAR(50),
    level_km INTEGER NOT NULL DEFAULT 1,
    account_count INTEGER NOT NULL DEFAULT 0,
    assigned_employee_id VARCHAR(50),
    geom geometry(POLYGON, 4326) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_grid_cells_level_km CHECK (level_km > 0),
    CONSTRAINT chk_grid_cells_account_count CHECK (account_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_employee_grid_cells_branch_level
  ON employee_grid_cells (branch_id, level_km);

CREATE INDEX IF NOT EXISTS idx_employee_grid_cells_branch_assigned_employee
  ON employee_grid_cells (branch_id, assigned_employee_id);

CREATE INDEX IF NOT EXISTS idx_employee_grid_cells_geom
  ON employee_grid_cells
  USING GIST (geom);

DROP TRIGGER IF EXISTS trigger_update_employee_grid_cells_timestamp ON employee_grid_cells;
CREATE TRIGGER trigger_update_employee_grid_cells_timestamp
  BEFORE UPDATE ON employee_grid_cells
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE FUNCTION territory_cells_adjacent(
    p_geom_a geometry,
    p_geom_b geometry
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    ST_Touches(p_geom_a, p_geom_b);
$$;

-- Capacitated region-growing assignment (adjacency-first BFS).
-- 1. Target + max capacity are computed from total accounts and employee count.
-- 2. Seeds come from KMeans cluster representatives (1 seed per employee).
-- 3. BFS grows one adjacent pocket at a time, prioritizing lowest workload ratio.
-- 4. No gap jumping during BFS. Claims are adjacency-only.
-- 5. Remaining orphans are assigned in a final cleanup by nearest employee territory.
CREATE OR REPLACE FUNCTION assign_employee_territories(
    p_branch_id VARCHAR,
    p_tolerance NUMERIC DEFAULT 0.10,
    p_employee_count INTEGER DEFAULT NULL,
    p_enforce_contiguity BOOLEAN DEFAULT TRUE
)
RETURNS TABLE (
    branch_id VARCHAR,
    grid_cell_id TEXT,
    employee_id VARCHAR,
    account_count INTEGER,
    geom geometry(MULTIPOLYGON, 4326)
)
LANGUAGE plpgsql
AS $$
#variable_conflict use_column
DECLARE
    v_employee_count INTEGER;
    v_cell_count INTEGER;
    v_total_accounts NUMERIC;
    v_target_workload NUMERIC;
    v_max_capacity NUMERIC;
    v_unassigned_count INTEGER;
    v_iter INTEGER := 0;
    v_pick_employee_id VARCHAR(50);
    v_pick_grid_cell_id TEXT;
    v_pick_account_count INTEGER;
BEGIN
    IF p_tolerance IS NULL THEN
      p_tolerance := 0.10;
    END IF;

    IF p_tolerance < 0 OR p_tolerance > 0.50 THEN
      RAISE EXCEPTION 'Tolerance must be between 0 and 0.50. Received: %', p_tolerance;
    END IF;

    IF p_enforce_contiguity IS NULL THEN
      p_enforce_contiguity := TRUE;
    END IF;

    PERFORM 1
    FROM branches
    WHERE id = p_branch_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Branch % does not exist', p_branch_id;
    END IF;

    CREATE TEMP TABLE tmp_employees (
      employee_id VARCHAR(50) PRIMARY KEY,
      ord INTEGER NOT NULL
    ) ON COMMIT DROP;

    IF p_employee_count IS NOT NULL THEN
      IF p_employee_count < 1 THEN
        RAISE EXCEPTION 'employee_count must be >= 1. Received: %', p_employee_count;
      END IF;

      INSERT INTO tmp_employees (employee_id, ord)
      SELECT
        ('emp_' || LPAD(series.seq::text, 3, '0'))::varchar(50) AS employee_id,
        series.seq - 1 AS ord
      FROM generate_series(1, p_employee_count) AS series(seq);
    ELSE
      INSERT INTO tmp_employees (employee_id, ord)
      SELECT
        branch_employees.employee_id,
        ROW_NUMBER() OVER (ORDER BY branch_employees.employee_id) - 1 AS ord
      FROM branch_employees
      WHERE branch_employees.branch_id = p_branch_id
        AND branch_employees.is_active = TRUE
      ORDER BY branch_employees.employee_id;
    END IF;

    SELECT COUNT(*) INTO v_employee_count
    FROM tmp_employees;

    IF v_employee_count = 0 THEN
      RAISE EXCEPTION 'No active employees configured for branch %', p_branch_id;
    END IF;

    CREATE TEMP TABLE tmp_cells (
      grid_cell_id TEXT PRIMARY KEY,
      branch_id VARCHAR(20) NOT NULL,
      account_count INTEGER NOT NULL,
      geom geometry(MULTIPOLYGON, 4326) NOT NULL,
      employee_id VARCHAR(50),
      is_seed BOOLEAN NOT NULL DEFAULT FALSE
    ) ON COMMIT DROP;

    INSERT INTO tmp_cells (grid_cell_id, branch_id, account_count, geom)
    WITH prepared AS (
      SELECT
        gc.id::text AS grid_cell_id,
        gc.branch_id,
        GREATEST(COALESCE(gc.account_count, 0), 0)::int AS account_count,
        ST_Multi(ST_CollectionExtract(ST_MakeValid(gc.geom), 3)) AS geom
      FROM employee_grid_cells gc
      WHERE gc.branch_id = p_branch_id
        AND COALESCE(gc.level_km, 1) = 1
        AND gc.geom IS NOT NULL
        AND NOT ST_IsEmpty(gc.geom)
    )
    SELECT
      prepared.grid_cell_id,
      prepared.branch_id,
      prepared.account_count,
      CASE
        WHEN ST_SRID(prepared.geom) = 4326 THEN prepared.geom
        WHEN ST_SRID(prepared.geom) = 0 THEN ST_SetSRID(prepared.geom, 4326)
        ELSE ST_Transform(prepared.geom, 4326)
      END::geometry(MULTIPOLYGON, 4326) AS geom
    FROM prepared
    WHERE prepared.geom IS NOT NULL
      AND NOT ST_IsEmpty(prepared.geom);

    SELECT COUNT(*) INTO v_cell_count
    FROM tmp_cells;
    IF v_cell_count = 0 THEN
      RETURN;
    END IF;

    IF v_cell_count < v_employee_count THEN
      RAISE EXCEPTION
        'Branch % has % employees but only % eligible 1km pockets',
        p_branch_id,
        v_employee_count,
        v_cell_count;
    END IF;

    CREATE INDEX idx_tmp_cells_geom ON tmp_cells USING GIST (geom);
    CREATE INDEX idx_tmp_cells_employee ON tmp_cells (employee_id);

    CREATE TEMP TABLE tmp_employee_stats (
      employee_id VARCHAR(50) PRIMARY KEY,
      current_accounts NUMERIC NOT NULL DEFAULT 0,
      is_locked BOOLEAN NOT NULL DEFAULT FALSE
    ) ON COMMIT DROP;

    INSERT INTO tmp_employee_stats (employee_id)
    SELECT tmp_employees.employee_id
    FROM tmp_employees;

    CREATE TEMP TABLE IF NOT EXISTS tmp_employee_territory_diagnostics (
      iteration INTEGER NOT NULL,
      claim_type TEXT NOT NULL,
      employee_id VARCHAR(50) NOT NULL,
      grid_cell_id TEXT NOT NULL,
      account_count INTEGER NOT NULL,
      current_accounts_before NUMERIC NOT NULL,
      current_accounts_after NUMERIC NOT NULL,
      target_workload NUMERIC NOT NULL,
      max_capacity NUMERIC NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ON COMMIT DROP;
    TRUNCATE tmp_employee_territory_diagnostics;

    SELECT COALESCE(SUM(tmp_cells.account_count), 0)::numeric INTO v_total_accounts
    FROM tmp_cells;

    v_target_workload :=
      CASE
        WHEN v_employee_count > 0 THEN v_total_accounts / v_employee_count
        ELSE 0
      END;

    v_max_capacity := v_target_workload * (1 + p_tolerance);

    -- Seed initialization with KMeans (k = employee count).
    WITH clustered AS (
      SELECT
        cells.grid_cell_id,
        cells.account_count,
        ST_PointOnSurface(cells.geom) AS point_geom,
        ST_ClusterKMeans(ST_PointOnSurface(cells.geom), v_employee_count) OVER () AS cluster_id
      FROM tmp_cells cells
    ),
    cluster_centroids AS (
      SELECT
        clustered.cluster_id,
        ST_Centroid(ST_Collect(clustered.point_geom)) AS centroid
      FROM clustered
      GROUP BY clustered.cluster_id
    ),
    ranked_seeds AS (
      SELECT
        clustered.cluster_id,
        clustered.grid_cell_id,
        ROW_NUMBER() OVER (
          PARTITION BY clustered.cluster_id
          ORDER BY
            clustered.account_count DESC,
            ST_Distance(clustered.point_geom, cluster_centroids.centroid),
            clustered.grid_cell_id
        ) AS cluster_rank
      FROM clustered
      JOIN cluster_centroids
        ON cluster_centroids.cluster_id = clustered.cluster_id
    ),
    cluster_seed_map AS (
      SELECT
        ranked_seeds.grid_cell_id,
        ROW_NUMBER() OVER (ORDER BY ranked_seeds.cluster_id) - 1 AS ord
      FROM ranked_seeds
      WHERE ranked_seeds.cluster_rank = 1
    ),
    seed_map AS (
      SELECT
        cluster_seed_map.grid_cell_id,
        employees.employee_id
      FROM cluster_seed_map
      JOIN tmp_employees employees
        ON employees.ord = cluster_seed_map.ord
    )
    UPDATE tmp_cells cells
    SET
      employee_id = seed_map.employee_id,
      is_seed = TRUE
    FROM seed_map
    WHERE cells.grid_cell_id = seed_map.grid_cell_id;

    -- Ensure one seed per employee.
    WITH missing_employees AS (
      SELECT
        employees.employee_id,
        ROW_NUMBER() OVER (ORDER BY employees.employee_id) AS rn
      FROM tmp_employees employees
      WHERE NOT EXISTS (
        SELECT 1
        FROM tmp_cells cells
        WHERE cells.employee_id = employees.employee_id
      )
    ),
    available_cells AS (
      SELECT
        cells.grid_cell_id,
        ROW_NUMBER() OVER (ORDER BY cells.account_count DESC, cells.grid_cell_id) AS rn
      FROM tmp_cells cells
      WHERE cells.employee_id IS NULL
    ),
    fill_map AS (
      SELECT
        missing_employees.employee_id,
        available_cells.grid_cell_id
      FROM missing_employees
      JOIN available_cells
        ON available_cells.rn = missing_employees.rn
    )
    UPDATE tmp_cells cells
    SET
      employee_id = fill_map.employee_id,
      is_seed = TRUE
    FROM fill_map
    WHERE cells.grid_cell_id = fill_map.grid_cell_id;

    -- Initialize employee account tallies from seeds.
    UPDATE tmp_employee_stats stats
    SET current_accounts = COALESCE(seed_totals.total_accounts, 0)
    FROM (
      SELECT
        cells.employee_id,
        SUM(cells.account_count)::numeric AS total_accounts
      FROM tmp_cells cells
      WHERE cells.employee_id IS NOT NULL
      GROUP BY cells.employee_id
    ) seed_totals
    WHERE stats.employee_id = seed_totals.employee_id;

    UPDATE tmp_employee_stats stats
    SET current_accounts = 0
    WHERE NOT EXISTS (
      SELECT 1
      FROM tmp_cells cells
      WHERE cells.employee_id = stats.employee_id
    );

    -- BFS assignment loop: claim one pocket per iteration.
    LOOP
      v_iter := v_iter + 1;
      EXIT WHEN v_iter > 25000;

      SELECT COUNT(*) INTO v_unassigned_count
      FROM tmp_cells
      WHERE employee_id IS NULL;
      EXIT WHEN v_unassigned_count = 0;

      UPDATE tmp_employee_stats stats
      SET is_locked = stats.current_accounts >= v_max_capacity;

      v_pick_employee_id := NULL;
      v_pick_grid_cell_id := NULL;
      v_pick_account_count := NULL;

      -- Strict adjacency candidate selection.
      SELECT
        ranked.employee_id,
        ranked.grid_cell_id,
        ranked.account_count
      INTO
        v_pick_employee_id,
        v_pick_grid_cell_id,
        v_pick_account_count
      FROM (
        SELECT
          candidate.employee_id,
          candidate.grid_cell_id,
          candidate.account_count
        FROM (
          SELECT
            stats.employee_id,
            unassigned.grid_cell_id,
            unassigned.account_count,
            CASE
              WHEN v_target_workload > 0 THEN stats.current_accounts / v_target_workload
              ELSE 0::numeric
            END AS workload_ratio,
            COALESCE(
              (
                SELECT MIN(
                  ST_Distance(
                    ST_PointOnSurface(unassigned.geom)::geography,
                    ST_PointOnSurface(owned.geom)::geography
                  )
                )
                FROM tmp_cells owned
                WHERE owned.employee_id = stats.employee_id
              ),
              0
            ) AS territory_distance
          FROM tmp_employee_stats stats
          JOIN tmp_cells unassigned
            ON unassigned.employee_id IS NULL
          WHERE stats.is_locked = FALSE
            AND stats.current_accounts + unassigned.account_count <= v_max_capacity
            AND EXISTS (
              SELECT 1
              FROM tmp_cells owned
              WHERE owned.employee_id = stats.employee_id
                AND territory_cells_adjacent(unassigned.geom, owned.geom)
            )
        ) candidate
        ORDER BY
          candidate.workload_ratio ASC,
          candidate.account_count DESC,
          candidate.territory_distance ASC,
          candidate.employee_id,
          candidate.grid_cell_id
        LIMIT 1
      ) ranked;

      IF v_pick_employee_id IS NOT NULL THEN
        UPDATE tmp_cells
        SET employee_id = v_pick_employee_id
        WHERE grid_cell_id = v_pick_grid_cell_id
          AND employee_id IS NULL;

        IF FOUND THEN
          WITH updated_stats AS (
            UPDATE tmp_employee_stats
            SET current_accounts = current_accounts + COALESCE(v_pick_account_count, 0)
            WHERE employee_id = v_pick_employee_id
            RETURNING
              employee_id,
              current_accounts - COALESCE(v_pick_account_count, 0) AS accounts_before,
              current_accounts AS accounts_after
          )
          INSERT INTO tmp_employee_territory_diagnostics (
            iteration,
            claim_type,
            employee_id,
            grid_cell_id,
            account_count,
            current_accounts_before,
            current_accounts_after,
            target_workload,
            max_capacity
          )
          SELECT
            v_iter,
            'adjacent',
            updated_stats.employee_id,
            v_pick_grid_cell_id,
            COALESCE(v_pick_account_count, 0),
            updated_stats.accounts_before,
            updated_stats.accounts_after,
            v_target_workload,
            v_max_capacity
          FROM updated_stats;
          CONTINUE;
        END IF;
      END IF;

      EXIT;
    END LOOP;

    -- Orphan cleanup: force assignment by geographic proximity.
    -- Prefer employees still under max capacity, then nearest territory, then lowest workload ratio.
    LOOP
      v_iter := v_iter + 1;
      SELECT COUNT(*) INTO v_unassigned_count
      FROM tmp_cells
      WHERE employee_id IS NULL;
      EXIT WHEN v_unassigned_count = 0;

      v_pick_employee_id := NULL;
      v_pick_grid_cell_id := NULL;
      v_pick_account_count := NULL;

      SELECT
        ranked.employee_id,
        ranked.grid_cell_id,
        ranked.account_count
      INTO
        v_pick_employee_id,
        v_pick_grid_cell_id,
        v_pick_account_count
      FROM (
        WITH employee_territories AS (
          SELECT
            stats.employee_id,
            stats.current_accounts,
            ST_UnaryUnion(ST_Collect(cells.geom)) AS territory_geom
          FROM tmp_employee_stats stats
          JOIN tmp_cells cells
            ON cells.employee_id = stats.employee_id
          GROUP BY
            stats.employee_id,
            stats.current_accounts
        ),
        orphan_candidates AS (
          SELECT
            unassigned.grid_cell_id,
            unassigned.account_count,
            territories.employee_id,
            CASE
              WHEN territories.current_accounts < v_max_capacity THEN 0
              ELSE 1
            END AS capacity_rank,
            CASE
              WHEN v_target_workload > 0 THEN territories.current_accounts / v_target_workload
              ELSE 0::numeric
            END AS workload_ratio,
            ST_Distance(
              ST_PointOnSurface(unassigned.geom)::geography,
              ST_ClosestPoint(
                territories.territory_geom,
                unassigned.geom
              )::geography
            ) AS territory_distance
          FROM tmp_cells unassigned
          JOIN employee_territories territories
            ON territories.territory_geom IS NOT NULL
           AND NOT ST_IsEmpty(territories.territory_geom)
          WHERE unassigned.employee_id IS NULL
        )
        SELECT
          orphan_candidates.employee_id,
          orphan_candidates.grid_cell_id,
          orphan_candidates.account_count
        FROM orphan_candidates
        ORDER BY
          orphan_candidates.capacity_rank ASC,
          orphan_candidates.territory_distance ASC,
          orphan_candidates.workload_ratio ASC,
          orphan_candidates.employee_id,
          orphan_candidates.grid_cell_id
        LIMIT 1
      ) ranked;

      EXIT WHEN v_pick_employee_id IS NULL;

      UPDATE tmp_cells
      SET employee_id = v_pick_employee_id
      WHERE grid_cell_id = v_pick_grid_cell_id
        AND employee_id IS NULL;

      EXIT WHEN NOT FOUND;

      WITH updated_stats AS (
        UPDATE tmp_employee_stats
        SET current_accounts = current_accounts + COALESCE(v_pick_account_count, 0)
        WHERE employee_id = v_pick_employee_id
        RETURNING
          employee_id,
          current_accounts - COALESCE(v_pick_account_count, 0) AS accounts_before,
          current_accounts AS accounts_after
      )
      INSERT INTO tmp_employee_territory_diagnostics (
        iteration,
        claim_type,
        employee_id,
        grid_cell_id,
        account_count,
        current_accounts_before,
        current_accounts_after,
        target_workload,
        max_capacity
      )
      SELECT
        v_iter,
        'orphan',
        updated_stats.employee_id,
        v_pick_grid_cell_id,
        COALESCE(v_pick_account_count, 0),
        updated_stats.accounts_before,
        updated_stats.accounts_after,
        v_target_workload,
        v_max_capacity
      FROM updated_stats;
    END LOOP;

    -- Final fallback if anything is still unassigned.
    IF EXISTS (SELECT 1 FROM tmp_cells WHERE employee_id IS NULL) THEN
      UPDATE tmp_cells
      SET employee_id = fallback.employee_id
      FROM (
        SELECT tmp_employees.employee_id
        FROM tmp_employees
        ORDER BY tmp_employees.ord
        LIMIT 1
      ) fallback
      WHERE tmp_cells.employee_id IS NULL;
    END IF;

    UPDATE employee_grid_cells gc
    SET
      assigned_employee_id = cells.employee_id,
      updated_at = CURRENT_TIMESTAMP
    FROM tmp_cells cells
    WHERE gc.id::text = cells.grid_cell_id
      AND gc.branch_id = p_branch_id;

    RETURN QUERY
    SELECT
      cells.branch_id,
      cells.grid_cell_id,
      cells.employee_id,
      cells.account_count,
      cells.geom
    FROM tmp_cells cells
    ORDER BY cells.employee_id, cells.grid_cell_id;
END;
$$;
