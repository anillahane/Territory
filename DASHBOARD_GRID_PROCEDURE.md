# Dashboard Grid Overlay Procedure

This document defines the exact procedure used to draw dashboard grid overlays so future changes keep alignment with pocket logic.

## Runtime Model
- Grid cells are **precomputed and stored in database** (`grid_cells`) per `config_version`.
- Frontend does **not** compute grid geometry.
- Frontend uses **MapLibre GL** with backend vector tiles.
- Frontend only:
  - requests `GET /api/v1/grids/manifest` once for metadata
  - loads vector tiles:
    - `GET /api/v1/grids/tiles/500/{z}/{x}/{y}.pbf`
    - `GET /api/v1/grids/tiles/100/{z}/{x}/{y}.pbf`
  - toggles layer visibility from checkbox state.

## Scope
- Map: India entity boundary overlay.
- Grid levels:
  - `500 km` (Level 0)
  - `100 km` (Level 1, nested inside Level 0)
  - `10 km` (Level 2, nested inside Level 1)
  - `5 km` (Level 3, nested inside Level 2)
  - `1 km` (Level 4, nested inside Level 3)
- Projection model for layout: **flat**, no curvature adjustment per-cell latitude.

## Required Inputs
- `originLat`, `originLon` from `/api/v1/config`
- `alphabet` (30 chars) from `/api/v1/config`
- India boundary bbox (`minLon`, `minLat`, `maxLon`, `maxLat`)
- Level size (`500000` or `100000` meters)

## Flat Conversion Rules
- Use constants:
  - `METERS_PER_DEGREE_LAT = 111000`
  - `metersPerDegreeLon = 111000 * cos(originLat)`
- Convert lat/lon to meters from origin:
  - `x = (lon - originLon) * metersPerDegreeLon`
  - `y = (lat - originLat) * METERS_PER_DEGREE_LAT`
- Convert meters back to lat/lon:
  - `lat = originLat + y / METERS_PER_DEGREE_LAT`
  - `lon = originLon + x / metersPerDegreeLon`

## Grid Construction
1. Convert India bbox corners to meter space.
2. For a given `cellSize`:
   - `startCol = floor(minX / cellSize)`
   - `endCol = floor(maxX / cellSize)`
   - `startRow = floor(minY / cellSize)`
   - `endRow = floor(maxY / cellSize)`
3. For each `(row, col)` in that range:
   - Build corners in meters:
     - `SW = (col*cellSize, row*cellSize)`
     - `SE = ((col+1)*cellSize, row*cellSize)`
     - `NE = ((col+1)*cellSize, (row+1)*cellSize)`
     - `NW = (col*cellSize, (row+1)*cellSize)`
   - Convert all 4 corners back to lat/lon.
   - Render as polygon (not lat/lon rectangle bounds).

## Box ID Rules
- Use positive modulo: `mod(v, n) = ((v % n) + n) % n`

### 500 km ID
- `row0 = mod(row, 30)`
- `col0 = mod(col, 30)`
- `code500 = alphabet[row0] + alphabet[col0]`

### 100 km ID (nested in 500 km)
- Global 100 km row/col must come from same origin-aligned 100 km grid.
- Parent 500 km index:
  - `parentRow = floor(row / 5)`
  - `parentCol = floor(col / 5)`
  - `parentCode = alphabet[mod(parentRow,30)] + alphabet[mod(parentCol,30)]`
- Child index inside parent:
  - `childRow = mod(row, 5)`
  - `childCol = mod(col, 5)`
  - `childCode = alphabet[childRow] + alphabet[childCol]`
- Final code:
  - `code100 = parentCode + "-" + childCode`

### 10 km, 5 km, 1 km IDs
- The same hierarchical construction continues level by level.
- Parent-child divisors:
  - `500 -> 100`: divisor `5`
  - `100 -> 10`: divisor `10`
  - `10 -> 5`: divisor `2`
  - `5 -> 1`: divisor `5`
- Final code format:
  - `10 km`: `AA-BB-CC`
  - `5 km`: `AA-BB-CC-DD`
  - `1 km`: `AA-BB-CC-DD-EE`
  - where each segment is 2 chars from configured alphabet.

## UI Rules
- Add checkbox toggles:
  - `500 km`
  - `100 km`
- Label placement:
  - Always visible (`permanent` tooltip).
  - Position at **NW corner** of each cell with small offset to keep text inside the box.

## Alignment Guarantee
Because both 500 km and 100 km overlays are generated from the same origin and flat meter conversion:
- Every 100 km cell edge aligns exactly to 500 km boundaries at 5-cell intervals.
- No drift between levels.

## Database Contract
- Table: `grid_cells`
- Key columns:
  - `config_version`
  - `level_m`
  - `row_idx`, `col_idx`
- Payload:
  - `code`
  - `label_lat`, `label_lon`
  - `corners` (JSON array: `[[swLat,swLon],[seLat,seLon],[neLat,neLon],[nwLat,nwLon]]`)
  - `geom` (`POLYGON`, SRID 4326) for tile polygon layer
  - `label_geom` (`POINT`, SRID 4326) for tile label layer

## Tile Layers
- Vector tile endpoint returns two source layers:
  - `grid_cells`: polygon geometries
  - `grid_labels`: label point geometries with `code`, `row`, `col`

## Storage Strategy
- `500 km` and `100 km` are precomputed as cell rows in `grid_cells`.
- `10 km`, `5 km`, `1 km` are generated procedurally per tile and cached in `grid_tile_cache`.
- This prevents exploding row counts (especially `1 km`) while keeping repeat loads fast.

## Automatic Cache Warming
- Backend can warm fine-level tiles in background at startup so first view is instant.
- Controls (env):
  - `GRID_WARM_ENABLED=true|false`
  - `GRID_WARM_LEVELS=10,5,1`
  - `GRID_WARM_ZOOMS_10=5,6`
  - `GRID_WARM_ZOOMS_5=6,7`
  - `GRID_WARM_ZOOMS_1=8`
  - `GRID_WARM_BOUNDS=minLon,minLat,maxLon,maxLat`
  - `GRID_WARM_MAX_TILES=2000`
  - `GRID_WARM_CONCURRENCY=4`
- Manual trigger/status endpoints:
  - `POST /api/v1/grids/warm`
  - `GET /api/v1/grids/warm-status`
