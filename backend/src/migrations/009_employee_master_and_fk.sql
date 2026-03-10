-- Upgrade employee master schema and link employee_territories to branch_employees.id
-- while preserving backward compatibility with legacy employee_id string fields.

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

ALTER TABLE branch_employees
  ADD COLUMN IF NOT EXISTS name VARCHAR(120);

ALTER TABLE branch_employees
  ADD COLUMN IF NOT EXISTS color_code VARCHAR(7);

ALTER TABLE branch_employees
  ADD COLUMN IF NOT EXISTS max_capacity INTEGER;

UPDATE branch_employees
SET name = COALESCE(
  NULLIF(btrim(name), ''),
  NULLIF(btrim(employee_name), ''),
  NULLIF(btrim(employee_id), ''),
  'Employee ' || id::text
)
WHERE name IS NULL OR btrim(name) = '';

WITH palette AS (
  SELECT ARRAY[
    '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6',
    '#14B8A6', '#2563EB', '#059669', '#D97706', '#DC2626',
    '#7C3AED', '#0D9488', '#1D4ED8', '#047857', '#B45309',
    '#B91C1C', '#6D28D9', '#0F766E', '#4F46E5', '#0284C7'
  ]::text[] AS colors
),
ranked AS (
  SELECT
    be.id,
    palette.colors[
      ((ROW_NUMBER() OVER (PARTITION BY be.branch_id ORDER BY be.id) - 1) % array_length(palette.colors, 1)) + 1
    ] AS assigned_color
  FROM branch_employees be
  CROSS JOIN palette
)
UPDATE branch_employees be
SET color_code = ranked.assigned_color
FROM ranked
WHERE be.id = ranked.id
  AND (be.color_code IS NULL OR btrim(be.color_code) = '');

ALTER TABLE branch_employees
  ALTER COLUMN color_code SET DEFAULT '#3B82F6';

ALTER TABLE branch_employees
  ALTER COLUMN name SET NOT NULL;

ALTER TABLE branch_employees
  ALTER COLUMN color_code SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_branch_employees_color_code'
  ) THEN
    ALTER TABLE branch_employees
      ADD CONSTRAINT chk_branch_employees_color_code
      CHECK (color_code ~ '^#[0-9A-Fa-f]{6}$');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_branch_employees_max_capacity'
  ) THEN
    ALTER TABLE branch_employees
      ADD CONSTRAINT chk_branch_employees_max_capacity
      CHECK (max_capacity IS NULL OR max_capacity >= 0);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_branch_employees_branch_id
  ON branch_employees (branch_id);

CREATE INDEX IF NOT EXISTS idx_branch_employees_branch_active
  ON branch_employees (branch_id, is_active);

-- Add normalized employee master FK to persistent employee territory assignments.
ALTER TABLE employee_territories
  ADD COLUMN IF NOT EXISTS branch_employee_id INTEGER;

-- Ensure branch_employees has rows for any existing employee_territories legacy entries.
WITH missing_employees AS (
  SELECT DISTINCT
    et.branch_id,
    et.employee_id::text AS employee_code
  FROM employee_territories et
  WHERE et.employee_id IS NOT NULL
    AND btrim(et.employee_id::text) <> ''
    AND NOT EXISTS (
      SELECT 1
      FROM branch_employees be
      WHERE be.branch_id = et.branch_id
        AND be.employee_id = et.employee_id::text
    )
)
INSERT INTO branch_employees (
  branch_id,
  employee_id,
  employee_name,
  name,
  color_code,
  is_active
)
SELECT
  missing_employees.branch_id,
  missing_employees.employee_code,
  missing_employees.employee_code,
  missing_employees.employee_code,
  '#3B82F6',
  TRUE
FROM missing_employees
ON CONFLICT (branch_id, employee_id)
DO NOTHING;

-- Backfill employee_territories.branch_employee_id.
UPDATE employee_territories et
SET branch_employee_id = be.id
FROM branch_employees be
WHERE et.branch_id = be.branch_id
  AND et.branch_employee_id IS NULL
  AND (
    (et.employee_id IS NOT NULL
      AND btrim(et.employee_id::text) <> ''
      AND be.employee_id = et.employee_id::text)
    OR be.id::text = et.employee_id::text
  );

-- Fallback assignment for any remaining rows: use first active employee in branch.
WITH branch_default_employee AS (
  SELECT
    be.branch_id,
    MIN(be.id)::int AS branch_employee_id
  FROM branch_employees be
  GROUP BY be.branch_id
)
UPDATE employee_territories et
SET branch_employee_id = branch_default_employee.branch_employee_id
FROM branch_default_employee
WHERE et.branch_employee_id IS NULL
  AND et.branch_id = branch_default_employee.branch_id;

-- Keep legacy employee_id in sync with employee master employee_id code.
UPDATE employee_territories et
SET employee_id = be.employee_id
FROM branch_employees be
WHERE be.id = et.branch_employee_id
  AND et.branch_id = be.branch_id
  AND (
    et.employee_id IS NULL
    OR btrim(et.employee_id::text) = ''
    OR et.employee_id::text <> be.employee_id
  );

ALTER TABLE employee_territories
  ALTER COLUMN branch_employee_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_employee_territories_branch_employee_id'
  ) THEN
    ALTER TABLE employee_territories
      ADD CONSTRAINT fk_employee_territories_branch_employee_id
      FOREIGN KEY (branch_employee_id)
      REFERENCES branch_employees(id)
      ON DELETE CASCADE;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_employee_territories_branch_employee
  ON employee_territories (branch_employee_id);
