# Machine Migration + Performance Optimization Playbook

**Project:** Territory Redesign / Location Pockets System  
**Prepared on:** 2026-03-04  
**Purpose:** Move this project to another machine and implement performance optimizations there without losing functionality.  
**Audience:** Engineers onboarding this codebase on a new machine.

---

## 1) Goal and Non-Goals

### Goal
- Reproduce the current system behavior on a new machine.
- Implement the performance improvements listed below.
- Keep API behavior and user-facing functionality unchanged.

### Non-Goals
- Feature redesign.
- API contract breaking changes.
- UI workflow changes beyond performance improvements.

---

## 2) Current System Snapshot (Baseline Context)

### Stack
- Backend: Node.js + Express + Bull + PostgreSQL/PostGIS + Redis
- Worker: Python (pandas + SQLAlchemy + Redis consumer)
- Frontend: React + Vite + MUI + MapLibre

### Services and Ports
- Frontend: `http://localhost:5173`
- Backend: `http://localhost:3000`
- Health: `http://localhost:3000/health`
- PostgreSQL: `localhost:5434` (container 5432)
- Redis: `localhost:6379`

### Current startup script
- Preferred script: `start-all.bat`
- Important: Docker Desktop must be running before startup.

### Noted baseline observations
- Frontend production bundle is currently large:
  - Main chunk: ~2,143.78 kB minified (~620.82 kB gzip)
- GeoJSON assets are large:
  - `backend/data/indiaStateBounds_official.geojson` ~13.62 MB
  - `frontend/public/data/indiaStateBounds_official.geojson` ~13.62 MB
  - `frontend/public/data/stateBorders_official.geojson` ~11.71 MB
- `backend/src/routes/batch.js` is very large (~1,629 lines), mixing many responsibilities.

---

## 3) Migration Prerequisites (New Machine)

### Required software
- Docker Desktop (running)
- Node.js `>=20`
- npm `>=10`
- Python `>=3.8` (prefer 3.11+)
- Git

### Required network access
- npm registry
- Docker Hub images (`postgis/postgis`, `redis`)

### Required folders/permissions
- Write permissions for:
  - `backend/uploads`
  - `backend/logs`
  - Docker volumes

---

## 4) Migration Steps (Bring Up Existing Behavior First)

### Step 1: Clone and install
```powershell
git clone <repo-url> "C:\MIS\Territory Redesign\Territory"
cd "C:\MIS\Territory Redesign\Territory"
```

### Step 2: Start baseline services
```powershell
.\start-all.bat
```

If startup fails with Docker engine pipe errors, start Docker Desktop manually and re-run.

### Step 3: Verify baseline
```powershell
docker compose ps
curl http://localhost:3000/health
```
- Expect backend health status `ok`.
- Open frontend at `http://localhost:5173`.

### Step 4: Baseline build check
```powershell
cd frontend
npm run build
cd ..
```

### Step 5: Baseline smoke tests
- Branch upload: UI path `/branches`
- Batch upload and status polling: `/batch`
- Mappings view: `/mappings`
- Dashboard territory visualization: `/`

Do not optimize before baseline behavior is confirmed.

---

## 5) Optimization Backlog (Priority Order)

## P0-1: Remove large queue payload retention (Redis memory pressure)

### Problem
- Batch jobs store full result Excel as base64 in Bull return value.
- Completed jobs are retained (`removeOnComplete: 100`), causing avoidable Redis growth.

### Current hotspots
- `backend/src/routes/batch.js` (returns `buffer: buffer.toString('base64')` from worker path)
- `backend/src/config/queue.js` (`removeOnComplete`)
- `backend/src/routes/jobs.js` (`GET /jobs/:jobId` returns `job.returnvalue`)

### Implementation
1. Store generated result file on disk for Node worker too (same as Python flow).
2. Return only metadata (`resultPath`, row counts, stats), not file bytes.
3. `GET /batch/download/:jobId` should always stream from disk.
4. Reduce completed-job retention for batch queue (example: 10 or age-based policy).
5. Ensure job status endpoint never returns large blobs.

### Acceptance criteria
- Download behavior unchanged for users.
- Redis memory remains stable after repeated large batches.
- `GET /jobs/:jobId` payload remains small.

---

## P0-2: Move nearest-branch calculations to PostGIS set-based queries

### Problem
- Nearest calculations are done in JS/Python loops (`O(pockets * branches)`), repeated in multiple paths.

### Current hotspots
- `backend/src/services/BranchFinderService.js`
- `backend/src/routes/batch.js` (territory and mapping assignment paths)
- `backend-worker/worker.py` nearest branch loops

### Implementation
1. Add geometry KNN index for fast nearest ordering:
   - expression index on `(geom::geometry)` if needed for `<->`.
2. Replace per-pocket in-memory loops with SQL set-based nearest lookup using `LATERAL`.
3. Keep exact distance output by combining KNN candidate + `ST_Distance` on geography.

### Suggested SQL pattern
```sql
WITH pockets AS (
  SELECT
    p.pocket_id,
    p.lat,
    p.lon,
    ST_SetSRID(ST_MakePoint(p.lon, p.lat), 4326)::geometry AS g
  FROM jsonb_to_recordset($1::jsonb) AS p(pocket_id text, lat double precision, lon double precision)
)
SELECT
  pockets.pocket_id,
  b.id AS branch_id,
  ST_Distance(b.geom, ST_SetSRID(ST_MakePoint(pockets.lon, pockets.lat), 4326)::geography) AS distance_m
FROM pockets
CROSS JOIN LATERAL (
  SELECT id, geom
  FROM branches
  ORDER BY (geom::geometry) <-> pockets.g
  LIMIT 1
) b;
```

### Acceptance criteria
- Same nearest-branch outputs for existing test datasets.
- Significantly lower CPU for large batch and territory requests.

---

## P0-3: Reduce worker memory spikes (streaming/chunking)

### Problem
- Workers currently load full workbook/rows and keep large arrays (`results`, `mappings`) in memory.

### Current hotspots
- Node worker in `backend/src/routes/batch.js`
- Python worker in `backend-worker/worker.py`

### Implementation
1. Node:
   - Move worker logic into dedicated module(s) from `batch.js`.
   - Use streaming write for output workbook (`exceljs` streaming writer recommended).
   - Batch-insert mappings incrementally (avoid holding all mappings).
2. Python:
   - Prefer `itertuples()` over `iterrows()` for row iteration.
   - Insert mappings with larger chunked multi-row inserts (`method='multi'`, tuned `chunksize`).
   - Keep only aggregate stats in memory.

### Acceptance criteria
- Large files complete with lower RAM.
- No functional regression in generated output and mapping persistence.

---

## P0-4: Split heavy `/customer-mappings` read path and cache expensive stats

### Problem
- A single request currently runs count + global stats + branch impact + paginated rows.

### Current hotspots
- `backend/src/services/MappingService.js`
- `frontend/src/pages/CustomerMappingView.tsx`

### Implementation
1. API split:
   - `/customer-mappings` -> paginated rows only
   - `/customer-mappings/stats` -> aggregate stats only
   - Keep compatibility using `includeStats=true` fallback if needed.
2. Cache stats by filter key (`jobId/customerId/pocketId`) for short TTL (e.g., 30-120s).
3. Frontend fetch strategy:
   - Fetch stats only when filters change.
   - Fetch rows when page/pageSize/filter changes.

### Acceptance criteria
- Mapping page interactions feel faster (pagination no longer blocked by full aggregate recomputation).
- API payload sizes reduced.

---

## P1-1: Add missing DB indexes for dominant query patterns

### Problem
- Query plans show scan/sort patterns that will degrade with data growth.

### Required migration scripts to add

#### `005_jobs_order_indexes.sql`
```sql
CREATE INDEX IF NOT EXISTS idx_jobs_created_at_desc
  ON jobs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_jobs_status_created_at_desc
  ON jobs (status, created_at DESC);
```

#### `006_branches_search_trgm.sql`
```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_branches_id_trgm
  ON branches USING gin (id gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_branches_city_trgm
  ON branches USING gin (city gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_branches_pocket_id_trgm
  ON branches USING gin (pocket_id gin_trgm_ops);
```

#### `007_branches_geom_knn.sql`
```sql
CREATE INDEX IF NOT EXISTS idx_branches_geom_geometry
  ON branches USING gist ((geom::geometry));
```

### Acceptance criteria
- Jobs list sorted queries use new indexes.
- Branch search no longer degrades as table grows.
- Nearest query uses index-assisted strategy.

---

## P1-2: Optimize territory visualization path

### Problem
- Server rebuilds heavy feature collections and clipped geometries repeatedly.
- Client requests full territory payload on each mode/selection change.

### Current hotspots
- `backend/src/routes/batch.js` (`/batch/territories/visualization`)
- `frontend/src/pages/Dashboard.tsx`

### Implementation
1. Cache computed visualization payload by key:
   - `(jobId, mode, branchIds, customerView)`
2. Return ETag/Last-Modified for unchanged payloads.
3. Optional: materialize branch coverage/territory results if job data is immutable.

### Acceptance criteria
- Repeated mode/branch toggles are much faster.
- Backend CPU drops for repeated visualization calls.

---

## P1-3: Reduce frontend render/polling pressure

### Problem
- Frequent polling and state updates trigger avoidable renders.

### Current hotspots
- `frontend/src/pages/BatchProcessing.tsx`
- `frontend/src/pages/Branches.tsx`
- `frontend/src/pages/Dashboard.tsx`

### Implementation
1. Replace fixed-interval polling with adaptive backoff:
   - e.g., 1s -> 2s -> 3s; reset on progress change.
2. Use router navigation API instead of `window.location.href`.
3. Throttle map panel updates from `move` events (or update on `moveend` only).
4. Cache branch markers in-memory in dashboard instead of refetching repeatedly.

### Acceptance criteria
- UI remains responsive during long jobs and map interaction.
- Fewer network calls during idle polling periods.

---

## P2-1: Frontend bundle reduction with code splitting

### Problem
- Single large JS chunk (~2.14 MB minified) increases load time.

### Current hotspots
- Route pages imported eagerly in `frontend/src/App.tsx`
- Heavy map dependencies in dashboard path

### Implementation
1. Use `React.lazy()` + `Suspense` for route-based code splitting.
2. Configure `vite.config.ts` `manualChunks` for map stack (`maplibre-gl`, map-heavy modules).
3. Keep source maps optional for production.

### Acceptance criteria
- Main entry chunk size materially reduced.
- Faster first load for non-map pages.

---

## P2-2: GeoJSON payload optimization

### Problem
- Large static GeoJSON files inflate network and parse time.

### Implementation
1. Simplify geometries (topology-preserving) for visualization scale.
2. Serve compressed assets in production.
3. Consider vector tiles if high zoom fidelity is needed later.

### Acceptance criteria
- Faster dashboard map load.
- Lower frontend memory and parse latency.

---

## 6) Suggested Implementation Order (Execution Plan)

1. Baseline parity on new machine (Section 4).
2. P0-1 queue payload fix.
3. P0-2 nearest lookup SQL migration + service replacement.
4. P0-3 worker memory improvements.
5. P0-4 mappings endpoint split + caching.
6. P1 DB index migrations.
7. P1 territory caching.
8. P1 frontend polling/render throttles.
9. P2 bundle and GeoJSON optimization.

Do not start P2 until P0/P1 are validated in staging.

---

## 7) Functionality Preservation Checklist

- Batch upload still supports:
  - Node worker path (small files)
  - Python worker path (large files)
  - Replace existing mappings option
- Branch upload modes still work:
  - `overwrite`
  - `add`
- Download endpoints still return expected file format (`.xlsx`)
- Territory visualization modes still return same semantics:
  - `existing_customers`
  - `nearest_pockets`
  - `customer_availability`
- Customer mapping filters/pagination semantics unchanged

---

## 8) Validation and Benchmark Checklist

## Functional validation
- Run backend tests:
```powershell
cd backend
npm test
```
- Run frontend tests:
```powershell
cd frontend
npm test
```

## Performance validation (minimum)
- Batch upload timing:
  - 1k rows
  - 5k rows
  - 10k+ rows
- Mappings page:
  - first load
  - pagination latency
- Territory endpoint:
  - cold request
  - repeated same-key request
- Redis memory before/after 20 completed jobs
- Frontend build chunk report after splitting

Record before/after in a simple table and keep in PR description.

---

## 9) Rollback Strategy

- Keep each optimization in separate PR.
- DB changes are additive index migrations first.
- For risky logic rewrites:
  - feature-flag new path via env vars (example: `USE_SQL_NEAREST=true`)
  - keep old path available until validated.
- If regression:
  - disable flag
  - redeploy previous image/commit
  - keep schema (indexes are safe to keep)

---

## 10) Known Hot Files (for implementer orientation)

- Backend
  - `backend/src/routes/batch.js`
  - `backend/src/services/MappingService.js`
  - `backend/src/services/BranchFinderService.js`
  - `backend/src/routes/jobs.js`
  - `backend/src/routes/nearest.js`
  - `backend/src/config/queue.js`
  - `backend/src/migrations/*.sql`
- Worker
  - `backend-worker/worker.py`
- Frontend
  - `frontend/src/pages/Dashboard.tsx`
  - `frontend/src/pages/BatchProcessing.tsx`
  - `frontend/src/pages/Branches.tsx`
  - `frontend/src/pages/CustomerMappingView.tsx`
  - `frontend/src/App.tsx`
  - `frontend/vite.config.ts`

---

## 11) Final Definition of Done

This migration/optimization effort is done when:
- New machine runs full system with parity.
- P0 items are implemented and validated.
- No functional regressions in upload/download/mapping/territory flows.
- Measured improvements are documented (API latency, memory, bundle, processing times).
- Team can operate from this document + code comments only.

