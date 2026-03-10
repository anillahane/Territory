-- Snap stored grid geometries to the global Web Mercator square grid origin.
-- Note: schema uses "geom" (not "geometry").

-- --- ORIGINAL BACKUP ---
-- WITH snapped AS (
--   SELECT
--     gc.id,
--     gc.level_m,
--     ST_Transform(
--       (
--         SELECT g.geom
--         FROM ST_SquareGrid(
--           gc.level_m,
--           ST_Transform(ST_Centroid(gc.geom), 3857)
--         ) AS g
--         LIMIT 1
--       ),
--       4326
--     )::geometry(POLYGON, 4326) AS snapped_geom
--   FROM grid_cells gc
--   WHERE gc.level_m IN (1000, 5000)
--     AND gc.geom IS NOT NULL
--     AND NOT ST_IsEmpty(gc.geom)
-- ),
-- updated AS (
--   UPDATE grid_cells gc
--   SET
--     geom = snapped.snapped_geom,
--     label_geom = ST_PointOnSurface(snapped.snapped_geom)::geometry(POINT, 4326),
--     label_lat = ST_Y(ST_PointOnSurface(snapped.snapped_geom)),
--     label_lon = ST_X(ST_PointOnSurface(snapped.snapped_geom)),
--     corners = jsonb_build_object(
--       'sw', jsonb_build_object(
--         'lat', ST_Y(ST_PointN(ST_ExteriorRing(snapped.snapped_geom), 1)),
--         'lon', ST_X(ST_PointN(ST_ExteriorRing(snapped.snapped_geom), 1))
--       ),
--       'se', jsonb_build_object(
--         'lat', ST_Y(ST_PointN(ST_ExteriorRing(snapped.snapped_geom), 2)),
--         'lon', ST_X(ST_PointN(ST_ExteriorRing(snapped.snapped_geom), 2))
--       ),
--       'ne', jsonb_build_object(
--         'lat', ST_Y(ST_PointN(ST_ExteriorRing(snapped.snapped_geom), 3)),
--         'lon', ST_X(ST_PointN(ST_ExteriorRing(snapped.snapped_geom), 3))
--       ),
--       'nw', jsonb_build_object(
--         'lat', ST_Y(ST_PointN(ST_ExteriorRing(snapped.snapped_geom), 4)),
--         'lon', ST_X(ST_PointN(ST_ExteriorRing(snapped.snapped_geom), 4))
--       )
--     )
--   FROM snapped
--   WHERE gc.id = snapped.id
--   RETURNING gc.id
-- )
-- SELECT COUNT(*)::int AS snapped_rows
-- FROM updated;

WITH prepared AS (
  SELECT
    gc.id,
    gc.level_m,
    ST_GeometryN(
      ST_Multi(
        ST_CollectionExtract(
          ST_MakeValid(gc.geom),
          3
        )
      ),
      1
    )::geometry(POLYGON, 4326) AS safe_geom
  FROM grid_cells gc
  WHERE gc.level_m IN (1000, 5000)
    AND gc.geom IS NOT NULL
    AND NOT ST_IsEmpty(gc.geom)
),
bounded AS (
  SELECT
    prepared.id,
    prepared.level_m,
    prepared.safe_geom
  FROM prepared
  WHERE prepared.safe_geom IS NOT NULL
    AND NOT ST_IsEmpty(prepared.safe_geom)
    AND ST_IsValid(prepared.safe_geom)
    AND ST_XMin(prepared.safe_geom) >= -180
    AND ST_XMax(prepared.safe_geom) <= 180
    AND ST_YMin(prepared.safe_geom) >= -90
    AND ST_YMax(prepared.safe_geom) <= 90
),
snapped AS (
  SELECT
    bounded.id,
    bounded.level_m,
    ST_Transform(
      (
        SELECT g.geom
        FROM ST_SquareGrid(
          bounded.level_m,
          ST_Transform(ST_Centroid(bounded.safe_geom), 3857)
        ) AS g
        LIMIT 1
      ),
      4326
    )::geometry(POLYGON, 4326) AS snapped_geom
  FROM bounded
),
updated AS (
  UPDATE grid_cells gc
  SET
    geom = snapped.snapped_geom,
    label_geom = ST_PointOnSurface(snapped.snapped_geom)::geometry(POINT, 4326),
    label_lat = ST_Y(ST_PointOnSurface(snapped.snapped_geom)),
    label_lon = ST_X(ST_PointOnSurface(snapped.snapped_geom)),
    corners = jsonb_build_object(
      'sw', jsonb_build_object(
        'lat', ST_Y(ST_PointN(ST_ExteriorRing(snapped.snapped_geom), 1)),
        'lon', ST_X(ST_PointN(ST_ExteriorRing(snapped.snapped_geom), 1))
      ),
      'se', jsonb_build_object(
        'lat', ST_Y(ST_PointN(ST_ExteriorRing(snapped.snapped_geom), 2)),
        'lon', ST_X(ST_PointN(ST_ExteriorRing(snapped.snapped_geom), 2))
      ),
      'ne', jsonb_build_object(
        'lat', ST_Y(ST_PointN(ST_ExteriorRing(snapped.snapped_geom), 3)),
        'lon', ST_X(ST_PointN(ST_ExteriorRing(snapped.snapped_geom), 3))
      ),
      'nw', jsonb_build_object(
        'lat', ST_Y(ST_PointN(ST_ExteriorRing(snapped.snapped_geom), 4)),
        'lon', ST_X(ST_PointN(ST_ExteriorRing(snapped.snapped_geom), 4))
      )
    )
  FROM snapped
  WHERE gc.id = snapped.id
    AND snapped.snapped_geom IS NOT NULL
    AND NOT ST_IsEmpty(snapped.snapped_geom)
  RETURNING gc.id
)
SELECT COUNT(*)::int AS snapped_rows
FROM updated;
