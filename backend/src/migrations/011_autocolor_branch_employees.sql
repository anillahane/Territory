-- Auto-assign default employee colors in fixed sequence for legacy rows.
-- Sequence: red, green, brown, dark yellow, black, white
-- Preserve custom colors and only update rows that are NULL/blank/legacy default blue.

BEGIN;

ALTER TABLE branch_employees
  ALTER COLUMN color_code SET DEFAULT '#D50711';

WITH palette AS (
  SELECT ARRAY[
    '#D50711', '#10B981', '#8B4513', '#B8860B', '#000000', '#FFFFFF'
  ]::text[] AS colors
),
legacy_rows AS (
  SELECT
    be.id,
    be.branch_id,
    ROW_NUMBER() OVER (PARTITION BY be.branch_id ORDER BY be.id) - 1 AS color_ord
  FROM branch_employees be
  WHERE be.color_code IS NULL
     OR btrim(be.color_code) = ''
     OR upper(be.color_code) = '#3B82F6'
),
assigned AS (
  SELECT
    legacy_rows.id,
    palette.colors[
      (legacy_rows.color_ord % array_length(palette.colors, 1)) + 1
    ] AS assigned_color
  FROM legacy_rows
  CROSS JOIN palette
)
UPDATE branch_employees be
SET
  color_code = assigned.assigned_color,
  updated_at = CURRENT_TIMESTAMP
FROM assigned
WHERE be.id = assigned.id;

COMMIT;
