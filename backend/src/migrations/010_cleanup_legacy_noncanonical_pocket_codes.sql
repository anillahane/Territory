-- One-time cleanup: remove legacy/non-canonical pocket codes from persistent territory tables.
-- Canonical format example: 23-11-00-00
-- Regex: ^[0-9]{2}(?:-[0-9]{2}){0,4}$

BEGIN;

WITH deleted_employee_territories AS (
  DELETE FROM employee_territories
  WHERE grid_code IS NULL
     OR grid_code !~ '^[0-9]{2}(?:-[0-9]{2}){0,4}$'
  RETURNING 1
),
deleted_branch_territories AS (
  DELETE FROM branch_territories
  WHERE grid_code IS NULL
     OR grid_code !~ '^[0-9]{2}(?:-[0-9]{2}){0,4}$'
  RETURNING 1
),
deleted_employee_grid_cells AS (
  DELETE FROM employee_grid_cells
  WHERE pocket_id IS NULL
     OR pocket_id !~ '^[0-9]{2}(?:-[0-9]{2}){0,4}$'
  RETURNING 1
)
SELECT
  (SELECT COUNT(*) FROM deleted_employee_territories) AS deleted_employee_territories,
  (SELECT COUNT(*) FROM deleted_branch_territories) AS deleted_branch_territories,
  (SELECT COUNT(*) FROM deleted_employee_grid_cells) AS deleted_employee_grid_cells;

COMMIT;
