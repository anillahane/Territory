const { query } = require('../config/database');
const logger = require('../config/logger');

const METERS_PER_DEGREE_LAT = 111000;
const SUPPORTED_LEVELS = [500000, 100000, 10000, 5000, 1000];
const PRECOMPUTED_LEVELS = [500000, 100000];
const DEFAULT_INDIA_BBOX = [68.0, 6.5, 97.5, 37.5]; // [minLon, minLat, maxLon, maxLat]
const MIN_ZOOM_BY_LEVEL = {
  500000: 0,
  100000: 0,
  10000: 5,
  5000: 6,
  1000: 8,
};
const WARM_DEFAULT_LEVELS_METERS = [10000, 5000, 1000];

let warmupPromise = null;
let warmupStatus = {
  inProgress: false,
  startedAt: null,
  endedAt: null,
  summary: null,
  lastError: null,
};

function flatMetersPerDegreeLon(originLat) {
  const latRad = (originLat * Math.PI) / 180;
  return METERS_PER_DEGREE_LAT * Math.cos(latRad);
}

function latLonToMeters(lat, lon, originLat, originLon) {
  const metersPerDegLon = flatMetersPerDegreeLon(originLat);
  return {
    x: (lon - originLon) * metersPerDegLon,
    y: (lat - originLat) * METERS_PER_DEGREE_LAT,
  };
}

function metersToLatLon(x, y, originLat, originLon) {
  const metersPerDegLon = flatMetersPerDegreeLon(originLat);
  return {
    lat: originLat + (y / METERS_PER_DEGREE_LAT),
    lon: originLon + (x / metersPerDegLon),
  };
}

function positiveMod(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

function getGridRange(indiaBbox, originLat, originLon, cellSize) {
  const [minLon, minLat, maxLon, maxLat] = indiaBbox;
  const bboxCorners = [
    latLonToMeters(minLat, minLon, originLat, originLon),
    latLonToMeters(minLat, maxLon, originLat, originLon),
    latLonToMeters(maxLat, minLon, originLat, originLon),
    latLonToMeters(maxLat, maxLon, originLat, originLon),
  ];
  const allX = bboxCorners.map((corner) => corner.x);
  const allY = bboxCorners.map((corner) => corner.y);

  return {
    startCol: Math.floor(Math.min(...allX) / cellSize),
    endCol: Math.floor(Math.max(...allX) / cellSize),
    startRow: Math.floor(Math.min(...allY) / cellSize),
    endRow: Math.floor(Math.max(...allY) / cellSize),
  };
}

function getHierarchyForLevel(levelMeters) {
  switch (levelMeters) {
    case 500000:
      return [500000];
    case 100000:
      return [500000, 100000];
    case 10000:
      return [500000, 100000, 10000];
    case 5000:
      return [500000, 100000, 10000, 5000];
    case 1000:
      return [500000, 100000, 10000, 5000, 1000];
    default:
      throw new Error(`Unsupported level for hierarchy: ${levelMeters}`);
  }
}

function createGridCode(levelMeters, row, col, alphabet) {
  const hierarchy = getHierarchyForLevel(levelMeters);
  const parts = [];

  let currentRow = row;
  let currentCol = col;

  for (let index = hierarchy.length - 1; index >= 0; index -= 1) {
    const size = hierarchy[index];

    if (index === 0) {
      const rowIndex = positiveMod(currentRow, 30);
      const colIndex = positiveMod(currentCol, 30);
      parts.unshift(`${alphabet[rowIndex]}${alphabet[colIndex]}`);
      continue;
    }

    const parentSize = hierarchy[index - 1];
    const divisor = Math.floor(parentSize / size);
    const rowIndex = positiveMod(currentRow, divisor);
    const colIndex = positiveMod(currentCol, divisor);
    parts.unshift(`${alphabet[rowIndex]}${alphabet[colIndex]}`);
    currentRow = Math.floor(currentRow / divisor);
    currentCol = Math.floor(currentCol / divisor);
  }

  return parts.join('-');
}

function polygonWktFromCorners(corners) {
  const points = [
    `${corners[0][1]} ${corners[0][0]}`,
    `${corners[1][1]} ${corners[1][0]}`,
    `${corners[2][1]} ${corners[2][0]}`,
    `${corners[3][1]} ${corners[3][0]}`,
    `${corners[0][1]} ${corners[0][0]}`,
  ];
  return `POLYGON((${points.join(', ')}))`;
}

function buildGridCells(levelMeters, indiaBbox, originLat, originLon, alphabet) {
  const { startCol, endCol, startRow, endRow } = getGridRange(
    indiaBbox,
    originLat,
    originLon,
    levelMeters
  );
  const cells = [];

  for (let row = startRow; row <= endRow; row += 1) {
    for (let col = startCol; col <= endCol; col += 1) {
      const swMeters = { x: col * levelMeters, y: row * levelMeters };
      const seMeters = { x: (col + 1) * levelMeters, y: row * levelMeters };
      const neMeters = { x: (col + 1) * levelMeters, y: (row + 1) * levelMeters };
      const nwMeters = { x: col * levelMeters, y: (row + 1) * levelMeters };

      const sw = metersToLatLon(swMeters.x, swMeters.y, originLat, originLon);
      const se = metersToLatLon(seMeters.x, seMeters.y, originLat, originLon);
      const ne = metersToLatLon(neMeters.x, neMeters.y, originLat, originLon);
      const nw = metersToLatLon(nwMeters.x, nwMeters.y, originLat, originLon);
      const corners = [
        [sw.lat, sw.lon],
        [se.lat, se.lon],
        [ne.lat, ne.lon],
        [nw.lat, nw.lon],
      ];

      cells.push({
        row,
        col,
        code: createGridCode(levelMeters, row, col, alphabet),
        labelLat: nw.lat,
        labelLon: nw.lon,
        corners,
        polygonWkt: polygonWktFromCorners(corners),
      });
    }
  }

  return cells;
}

async function getExistingLevelCount(configVersion, levelMeters) {
  const result = await query(
    `SELECT COUNT(*)::int AS count
     FROM grid_cells
     WHERE config_version = $1 AND level_m = $2`,
    [configVersion, levelMeters]
  );
  return result.rows[0].count;
}

async function insertGridCells(configVersion, levelMeters, cells) {
  if (cells.length === 0) {
    return;
  }

  const batchSize = 1000;

  for (let offset = 0; offset < cells.length; offset += batchSize) {
    const batch = cells.slice(offset, offset + batchSize);
    const values = [];
    const placeholders = batch.map((cell, index) => {
      const paramOffset = index * 11;
      values.push(
        configVersion,
        levelMeters,
        cell.row,
        cell.col,
        cell.code,
        cell.labelLat,
        cell.labelLon,
        JSON.stringify(cell.corners),
        cell.polygonWkt,
        cell.labelLon,
        cell.labelLat
      );

      return `($${paramOffset + 1}, $${paramOffset + 2}, $${paramOffset + 3}, $${paramOffset + 4}, $${paramOffset + 5}, $${paramOffset + 6}, $${paramOffset + 7}, $${paramOffset + 8}::jsonb, ST_GeomFromText($${paramOffset + 9}, 4326), ST_SetSRID(ST_MakePoint($${paramOffset + 10}, $${paramOffset + 11}), 4326))`;
    });

    // eslint-disable-next-line no-await-in-loop
    await query(
      `INSERT INTO grid_cells
        (config_version, level_m, row_idx, col_idx, code, label_lat, label_lon, corners, geom, label_geom)
       VALUES ${placeholders.join(', ')}
       ON CONFLICT (config_version, level_m, row_idx, col_idx)
       DO UPDATE SET
         geom = COALESCE(grid_cells.geom, EXCLUDED.geom),
         label_geom = COALESCE(grid_cells.label_geom, EXCLUDED.label_geom)`,
      values
    );
  }
}

async function ensurePrecomputedGrid(config, levelMeters = null) {
  const indiaBbox = DEFAULT_INDIA_BBOX;
  const levelsToEnsure = levelMeters
    ? PRECOMPUTED_LEVELS.filter((value) => value === levelMeters)
    : PRECOMPUTED_LEVELS;

  for (const level of levelsToEnsure) {
    // eslint-disable-next-line no-await-in-loop
    const existingCount = await getExistingLevelCount(config.version, level);
    if (existingCount > 0) {
      // eslint-disable-next-line no-continue
      continue;
    }

    const cells = buildGridCells(
      level,
      indiaBbox,
      config.originLat,
      config.originLon,
      config.alphabet
    );

    // eslint-disable-next-line no-await-in-loop
    await insertGridCells(config.version, level, cells);
  }
}

async function fetchGridCells(configVersion, levelMeters) {
  const result = await query(
    `SELECT
        row_idx AS row,
        col_idx AS col,
        code,
        label_lat,
        label_lon,
        corners
     FROM grid_cells
     WHERE config_version = $1 AND level_m = $2
     ORDER BY row_idx, col_idx`,
    [configVersion, levelMeters]
  );

  return result.rows.map((row) => ({
    id: `${row.row}-${row.col}`,
    row: row.row,
    col: row.col,
    code: row.code,
    labelPosition: [row.label_lat, row.label_lon],
    corners: row.corners,
  }));
}

function getMinZoomForLevel(levelMeters) {
  return MIN_ZOOM_BY_LEVEL[levelMeters] ?? 0;
}

function isWarmupEnabledByEnv() {
  return process.env.GRID_WARM_ENABLED !== 'false';
}

function parseIntegerList(value) {
  if (!value || typeof value !== 'string') {
    return [];
  }

  return value
    .split(',')
    .map((item) => parseInt(item.trim(), 10))
    .filter((num) => Number.isInteger(num));
}

function parseBoundsList(value) {
  if (!value || typeof value !== 'string') {
    return [DEFAULT_INDIA_BBOX];
  }

  const parsed = value
    .split(';')
    .map((part) => part
      .split(',')
      .map((x) => Number(x.trim())))
    .filter((arr) => arr.length === 4 && arr.every((num) => Number.isFinite(num)));

  if (parsed.length === 0) {
    return [DEFAULT_INDIA_BBOX];
  }

  return parsed;
}

function getDefaultZoomsForLevel(levelMeters) {
  switch (levelMeters) {
    case 10000:
      return [5, 6];
    case 5000:
      return [6, 7];
    case 1000:
      return [8];
    default:
      return [getMinZoomForLevel(levelMeters)];
  }
}

function lonToTileX(lon, z) {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  return Math.max(0, Math.min(n - 1, x));
}

function latToTileY(lat, z) {
  const latClamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const latRad = (latClamped * Math.PI) / 180;
  const n = 2 ** z;
  const y = Math.floor(
    ((1 - (Math.log(Math.tan(latRad) + (1 / Math.cos(latRad))) / Math.PI)) / 2) * n
  );
  return Math.max(0, Math.min(n - 1, y));
}

function buildTileRange(bounds, z) {
  const [minLon, minLat, maxLon, maxLat] = bounds;
  const startX = lonToTileX(minLon, z);
  const endX = lonToTileX(maxLon, z);
  const startY = latToTileY(maxLat, z);
  const endY = latToTileY(minLat, z);

  return { startX, endX, startY, endY };
}

async function getActiveConfig() {
  const configResult = await query(
    'SELECT id, origin_lat, origin_lon, alphabet, version FROM config WHERE id = 1'
  );

  if (configResult.rows.length === 0) {
    throw new Error('Configuration not found');
  }

  return {
    id: configResult.rows[0].id,
    originLat: configResult.rows[0].origin_lat,
    originLon: configResult.rows[0].origin_lon,
    alphabet: configResult.rows[0].alphabet,
    version: configResult.rows[0].version,
  };
}

async function fetchCachedTile(configVersion, levelMeters, z, x, y) {
  const result = await query(
    `SELECT tile
     FROM grid_tile_cache
     WHERE config_version = $1
       AND level_m = $2
       AND z = $3
       AND x = $4
       AND y = $5
     LIMIT 1`,
    [configVersion, levelMeters, z, x, y]
  );

  if (result.rowCount === 0) {
    return null;
  }

  return result.rows[0].tile;
}

async function upsertTileCache(configVersion, levelMeters, z, x, y, tileBuffer) {
  await query(
    `INSERT INTO grid_tile_cache (config_version, level_m, z, x, y, tile)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (config_version, level_m, z, x, y)
     DO UPDATE SET
       tile = EXCLUDED.tile,
       created_at = CURRENT_TIMESTAMP`,
    [configVersion, levelMeters, z, x, y, tileBuffer]
  );
}

async function fetchPrecomputedGridTile(configVersion, levelMeters, z, x, y) {
  const result = await query(
    `WITH bounds AS (
        SELECT
          ST_TileEnvelope($1, $2, $3) AS geom_3857,
          ST_Transform(ST_TileEnvelope($1, $2, $3), 4326) AS geom_4326
      ),
      cells AS (
        SELECT
          code,
          row_idx AS row,
          col_idx AS col,
          ST_AsMVTGeom(
            ST_Transform(gc.geom, 3857),
            b.geom_3857,
            4096,
            64,
            true
          ) AS geom
        FROM grid_cells gc
        CROSS JOIN bounds b
        WHERE gc.config_version = $4
          AND gc.level_m = $5
          AND gc.geom IS NOT NULL
          AND ST_Intersects(gc.geom, b.geom_4326)
      ),
      labels AS (
        SELECT
          code,
          row_idx AS row,
          col_idx AS col,
          ST_AsMVTGeom(
            ST_Transform(gc.label_geom, 3857),
            b.geom_3857,
            4096,
            64,
            true
          ) AS geom
        FROM grid_cells gc
        CROSS JOIN bounds b
        WHERE gc.config_version = $4
          AND gc.level_m = $5
          AND gc.label_geom IS NOT NULL
          AND ST_Intersects(gc.label_geom, b.geom_4326)
      )
      SELECT
        COALESCE((SELECT ST_AsMVT(cells, 'grid_cells', 4096, 'geom') FROM cells), ''::bytea)
        ||
        COALESCE((SELECT ST_AsMVT(labels, 'grid_labels', 4096, 'geom') FROM labels), ''::bytea)
          AS tile`,
    [z, x, y, configVersion, levelMeters]
  );

  return result.rows[0]?.tile || Buffer.alloc(0);
}

async function fetchProceduralGridTile(config, levelMeters, z, x, y) {
  const metersPerDegLon = flatMetersPerDegreeLon(config.originLat);

  const result = await query(
    `WITH params AS (
        SELECT
          $1::int AS z,
          $2::int AS x,
          $3::int AS y,
          $4::int AS level_m,
          $5::double precision AS origin_lat,
          $6::double precision AS origin_lon,
          $7::double precision AS meters_per_deg_lon,
          $8::text AS alphabet
      ),
      bounds AS (
        SELECT
          p.*,
          ST_TileEnvelope(p.z, p.x, p.y) AS geom_3857,
          ST_Transform(ST_TileEnvelope(p.z, p.x, p.y), 4326) AS geom_4326
        FROM params p
      ),
      extent AS (
        SELECT
          b.*,
          FLOOR(((ST_XMin(b.geom_4326) - b.origin_lon) * b.meters_per_deg_lon) / b.level_m)::int AS start_col,
          FLOOR(((ST_XMax(b.geom_4326) - b.origin_lon) * b.meters_per_deg_lon) / b.level_m)::int AS end_col,
          FLOOR(((ST_YMin(b.geom_4326) - b.origin_lat) * 111000.0) / b.level_m)::int AS start_row,
          FLOOR(((ST_YMax(b.geom_4326) - b.origin_lat) * 111000.0) / b.level_m)::int AS end_row
        FROM bounds b
      ),
      series AS (
        SELECT
          e.*,
          row_idx,
          col_idx
        FROM extent e
        CROSS JOIN LATERAL generate_series(e.start_row, e.end_row) AS row_idx
        CROSS JOIN LATERAL generate_series(e.start_col, e.end_col) AS col_idx
      ),
      grid AS (
        SELECT
          s.*,
          (s.origin_lat + ((s.row_idx * s.level_m) / 111000.0)) AS sw_lat,
          (s.origin_lon + ((s.col_idx * s.level_m) / s.meters_per_deg_lon)) AS sw_lon,
          (s.origin_lat + (((s.row_idx + 1) * s.level_m) / 111000.0)) AS nw_lat,
          (s.origin_lon + (((s.col_idx + 1) * s.level_m) / s.meters_per_deg_lon)) AS ne_lon
        FROM series s
      ),
      coded AS (
        SELECT
          g.*,
          CASE g.level_m
            WHEN 10000 THEN (
              SUBSTR(g.alphabet, ((MOD(FLOOR(g.row_idx / 50.0)::int, 30) + 30) % 30) + 1, 1)
              || SUBSTR(g.alphabet, ((MOD(FLOOR(g.col_idx / 50.0)::int, 30) + 30) % 30) + 1, 1)
              || '-'
              || SUBSTR(g.alphabet, ((MOD(FLOOR(g.row_idx / 10.0)::int, 5) + 5) % 5) + 1, 1)
              || SUBSTR(g.alphabet, ((MOD(FLOOR(g.col_idx / 10.0)::int, 5) + 5) % 5) + 1, 1)
              || '-'
              || SUBSTR(g.alphabet, ((MOD(g.row_idx, 10) + 10) % 10) + 1, 1)
              || SUBSTR(g.alphabet, ((MOD(g.col_idx, 10) + 10) % 10) + 1, 1)
            )
            WHEN 5000 THEN (
              SUBSTR(g.alphabet, ((MOD(FLOOR(g.row_idx / 100.0)::int, 30) + 30) % 30) + 1, 1)
              || SUBSTR(g.alphabet, ((MOD(FLOOR(g.col_idx / 100.0)::int, 30) + 30) % 30) + 1, 1)
              || '-'
              || SUBSTR(g.alphabet, ((MOD(FLOOR(g.row_idx / 20.0)::int, 5) + 5) % 5) + 1, 1)
              || SUBSTR(g.alphabet, ((MOD(FLOOR(g.col_idx / 20.0)::int, 5) + 5) % 5) + 1, 1)
              || '-'
              || SUBSTR(g.alphabet, ((MOD(FLOOR(g.row_idx / 2.0)::int, 10) + 10) % 10) + 1, 1)
              || SUBSTR(g.alphabet, ((MOD(FLOOR(g.col_idx / 2.0)::int, 10) + 10) % 10) + 1, 1)
              || '-'
              || SUBSTR(g.alphabet, ((MOD(g.row_idx, 2) + 2) % 2) + 1, 1)
              || SUBSTR(g.alphabet, ((MOD(g.col_idx, 2) + 2) % 2) + 1, 1)
            )
            WHEN 1000 THEN (
              SUBSTR(g.alphabet, ((MOD(FLOOR(g.row_idx / 500.0)::int, 30) + 30) % 30) + 1, 1)
              || SUBSTR(g.alphabet, ((MOD(FLOOR(g.col_idx / 500.0)::int, 30) + 30) % 30) + 1, 1)
              || '-'
              || SUBSTR(g.alphabet, ((MOD(FLOOR(g.row_idx / 100.0)::int, 5) + 5) % 5) + 1, 1)
              || SUBSTR(g.alphabet, ((MOD(FLOOR(g.col_idx / 100.0)::int, 5) + 5) % 5) + 1, 1)
              || '-'
              || SUBSTR(g.alphabet, ((MOD(FLOOR(g.row_idx / 10.0)::int, 10) + 10) % 10) + 1, 1)
              || SUBSTR(g.alphabet, ((MOD(FLOOR(g.col_idx / 10.0)::int, 10) + 10) % 10) + 1, 1)
              || '-'
              || SUBSTR(g.alphabet, ((MOD(FLOOR(g.row_idx / 5.0)::int, 2) + 2) % 2) + 1, 1)
              || SUBSTR(g.alphabet, ((MOD(FLOOR(g.col_idx / 5.0)::int, 2) + 2) % 2) + 1, 1)
              || '-'
              || SUBSTR(g.alphabet, ((MOD(g.row_idx, 5) + 5) % 5) + 1, 1)
              || SUBSTR(g.alphabet, ((MOD(g.col_idx, 5) + 5) % 5) + 1, 1)
            )
            ELSE ''
          END AS code,
          ST_SetSRID(
            ST_MakePolygon(
              ST_MakeLine(ARRAY[
                ST_MakePoint(g.sw_lon, g.sw_lat),
                ST_MakePoint(g.ne_lon, g.sw_lat),
                ST_MakePoint(g.ne_lon, g.nw_lat),
                ST_MakePoint(g.sw_lon, g.nw_lat),
                ST_MakePoint(g.sw_lon, g.sw_lat)
              ])
            ),
            4326
          ) AS cell_geom,
          ST_SetSRID(ST_MakePoint(g.sw_lon, g.nw_lat), 4326) AS label_geom
        FROM grid g
      ),
      cells AS (
        SELECT
          code,
          row_idx AS row,
          col_idx AS col,
          ST_AsMVTGeom(
            ST_Transform(cell_geom, 3857),
            c.geom_3857,
            4096,
            64,
            true
          ) AS geom
        FROM coded
        CROSS JOIN bounds c
        WHERE ST_Intersects(cell_geom, c.geom_4326)
      ),
      labels AS (
        SELECT
          code,
          row_idx AS row,
          col_idx AS col,
          ST_AsMVTGeom(
            ST_Transform(label_geom, 3857),
            c.geom_3857,
            4096,
            64,
            true
          ) AS geom
        FROM coded
        CROSS JOIN bounds c
        WHERE ST_Intersects(label_geom, c.geom_4326)
      )
      SELECT
        COALESCE((SELECT ST_AsMVT(cells, 'grid_cells', 4096, 'geom') FROM cells), ''::bytea)
        ||
        COALESCE((SELECT ST_AsMVT(labels, 'grid_labels', 4096, 'geom') FROM labels), ''::bytea)
          AS tile`,
    [
      z,
      x,
      y,
      levelMeters,
      config.originLat,
      config.originLon,
      metersPerDegLon,
      config.alphabet,
    ]
  );

  return result.rows[0]?.tile || Buffer.alloc(0);
}

async function fetchGridTile(config, levelMeters, z, x, y) {
  const cachedTile = await fetchCachedTile(config.version, levelMeters, z, x, y);
  if (cachedTile) {
    return cachedTile;
  }

  let tile;
  if (PRECOMPUTED_LEVELS.includes(levelMeters)) {
    tile = await fetchPrecomputedGridTile(config.version, levelMeters, z, x, y);
  } else {
    tile = await fetchProceduralGridTile(config, levelMeters, z, x, y);
  }

  await upsertTileCache(config.version, levelMeters, z, x, y, tile);
  return tile;
}

function getGridWarmStatus() {
  return {
    ...warmupStatus,
    inProgress: Boolean(warmupPromise),
  };
}

async function warmGridTileCache(options = {}) {
  if (warmupPromise) {
    return warmupPromise;
  }

  warmupPromise = (async () => {
    const startedAt = new Date().toISOString();
    warmupStatus = {
      ...warmupStatus,
      inProgress: true,
      startedAt,
      lastError: null,
    };

    const config = options.config || (await getActiveConfig());
    await ensurePrecomputedGrid(config);

    const configuredLevels = Array.isArray(options.levelsMeters)
      ? options.levelsMeters
      : parseIntegerList(process.env.GRID_WARM_LEVELS).map((km) => km * 1000);
    const levelsMeters = (configuredLevels.length > 0 ? configuredLevels : WARM_DEFAULT_LEVELS_METERS)
      .filter((level) => SUPPORTED_LEVELS.includes(level));
    const globalZooms = parseIntegerList(process.env.GRID_WARM_ZOOMS);

    const maxTiles = Number.isInteger(options.maxTiles)
      ? options.maxTiles
      : parseInt(process.env.GRID_WARM_MAX_TILES || '2000', 10);
    const concurrency = Number.isInteger(options.concurrency)
      ? options.concurrency
      : parseInt(process.env.GRID_WARM_CONCURRENCY || '4', 10);
    const boundsList = Array.isArray(options.boundsList) && options.boundsList.length > 0
      ? options.boundsList
      : parseBoundsList(process.env.GRID_WARM_BOUNDS);

    const taskKeys = new Set();
    const tasks = [];

    for (const levelMeters of levelsMeters) {
      const envPerLevel = parseIntegerList(process.env[`GRID_WARM_ZOOMS_${levelMeters / 1000}`]);
      let zooms = getDefaultZoomsForLevel(levelMeters);
      if (globalZooms.length > 0) {
        zooms = globalZooms;
      }
      if (envPerLevel.length > 0) {
        zooms = envPerLevel;
      }
      if (Array.isArray(options.zooms) && options.zooms.length > 0) {
        zooms = options.zooms;
      }
      const minZoom = getMinZoomForLevel(levelMeters);

      for (const z of zooms) {
        if (!Number.isInteger(z) || z < minZoom || z > 22) {
          // eslint-disable-next-line no-continue
          continue;
        }

        for (const bounds of boundsList) {
          const { startX, endX, startY, endY } = buildTileRange(bounds, z);
          for (let x = startX; x <= endX; x += 1) {
            for (let y = startY; y <= endY; y += 1) {
              const key = `${levelMeters}:${z}:${x}:${y}`;
              if (taskKeys.has(key)) {
                // eslint-disable-next-line no-continue
                continue;
              }
              taskKeys.add(key);
              tasks.push({ levelMeters, z, x, y });
            }
          }
        }
      }
    }

    const limitedTasks = tasks.slice(0, Math.max(0, maxTiles));
    let warmed = 0;
    let failed = 0;
    let cursor = 0;

    const workerCount = Math.max(1, Math.min(concurrency, limitedTasks.length || 1));
    logger.info(
      `Grid warmup started: tasks=${limitedTasks.length}, levels=${levelsMeters.join(',')}, concurrency=${workerCount}`
    );

    const workers = Array.from({ length: workerCount }, () => (async () => {
      while (cursor < limitedTasks.length) {
        const task = limitedTasks[cursor];
        cursor += 1;

        try {
          // eslint-disable-next-line no-await-in-loop
          await fetchGridTile(config, task.levelMeters, task.z, task.x, task.y);
          warmed += 1;
        } catch (error) {
          failed += 1;
          if (failed <= 10) {
            logger.warn(
              `Grid warmup tile failed level=${task.levelMeters} z=${task.z} x=${task.x} y=${task.y}: ${error.message}`
            );
          }
        }

        if ((warmed + failed) % 250 === 0) {
          logger.info(`Grid warmup progress: processed=${warmed + failed}/${limitedTasks.length}`);
        }
      }
    })());

    await Promise.all(workers);

    const summary = {
      processed: limitedTasks.length,
      warmed,
      failed,
      levelsMeters,
      maxTiles,
      concurrency: workerCount,
      boundsCount: boundsList.length,
      configVersion: config.version,
      startedAt,
      endedAt: new Date().toISOString(),
    };

    warmupStatus = {
      inProgress: false,
      startedAt,
      endedAt: summary.endedAt,
      summary,
      lastError: null,
    };

    logger.info(
      `Grid warmup completed: warmed=${warmed}, failed=${failed}, processed=${limitedTasks.length}`
    );
    return summary;
  })().catch((error) => {
    warmupStatus = {
      ...warmupStatus,
      inProgress: false,
      endedAt: new Date().toISOString(),
      lastError: error.message,
    };
    logger.error(`Grid warmup failed: ${error.message}`);
    throw error;
  }).finally(() => {
    warmupPromise = null;
  });

  return warmupPromise;
}

module.exports = {
  SUPPORTED_LEVELS,
  PRECOMPUTED_LEVELS,
  ensurePrecomputedGrid,
  fetchGridCells,
  fetchGridTile,
  getMinZoomForLevel,
  warmGridTileCache,
  getGridWarmStatus,
  isWarmupEnabledByEnv,
};
