# Location Pockets Territory Platform

Last updated: 2026-03-10

## Overview
This project is a full-stack GIS platform for branch, pocket, customer, and employee territory management.

It supports:
- Hierarchical pocket ID generation (500km -> 100km -> 20km -> 5km -> 1km)
- Branch and customer pocket mapping
- Auto/manual employee territory allocation
- Admin health checks and repair workflows
- Hybrid batch processing (Node.js + Python worker)

## Tech Structure

### Frontend
- React 18 + TypeScript + Vite
- Material UI
- Zustand store
- Axios API client
- Map rendering with MapLibre GL (legacy Leaflet deps still present)

Main frontend folders:
- `frontend/src/pages`
- `frontend/src/components`
- `frontend/src/services`
- `frontend/src/store`

### Backend API
- Node.js + Express
- Joi validation
- Winston + Morgan logging
- Bull queue integration

Main backend folders:
- `backend/src/routes`
- `backend/src/services`
- `backend/src/utils`
- `backend/src/workers`
- `backend/src/migrations`

Primary API route modules:
- `config.js`
- `branches.js`
- `batch.js`
- `territories.js`
- `employees.js`
- `grids.js`
- `customerMappings.js`
- `admin.js`
- `jobs.js`
- `health.js`

### Data and Queue Layer
- PostgreSQL + PostGIS
- Redis
- Bull queue

### Python Worker
- `backend-worker/worker.py`
- Used for large batch uploads
- Reads jobs from Redis list `python_batch_jobs`

### Containers
Defined in `docker-compose.yml`:
- `postgres` (`localhost:5434` -> container `5432`)
- `redis` (`localhost:6379`)
- `backend`
- `frontend`
- `python-worker`

## Repository Structure

```text
Territory/
  backend/
    src/
      app.js
      routes/
      services/
      utils/
      workers/
      migrations/
  backend-worker/
    worker.py
  frontend/
    src/
      App.tsx
      pages/
      components/
      services/
      store/
  Files/
  docker-compose.yml
  start-all.bat
  stop-all.bat
```

## Run Instructions

### Recommended (Windows, current team flow)
1. Start Docker Desktop.
2. From project root:
   - `start-all.bat`
3. Validate:
   - Frontend: `http://localhost:5173`
   - Backend health: `http://localhost:3000/health`

### Stop services
- `stop-all.bat`

### Manual start (if needed)
1. Start infra:
   - `docker-compose up -d postgres redis python-worker`
2. Start backend:
   - `cd backend`
   - `node src/app.js`
3. Start frontend:
   - `cd frontend`
   - `npm run dev`

## Database Instructions

### Run migrations
```bash
cd backend
node src/migrations/run.js
```

### Important migration set currently in project
- `001` initial schema
- `003` customer mappings table
- `006` persistent territory tables
- `008` branch catchments backfill
- `009` employee master + FK alignment
- `010` cleanup legacy non-canonical pocket codes
- `011` auto color
- `012` tier-2 bbox + two-way sync fields
- `013` grid level constraint fix
- `014` rewrite legacy grid codes to canonical

## Operational Data Sequence (Recommended)
Use this sequence to avoid inconsistent territory states.

1. Confirm config:
   - origin, alphabet, grid levels in `System Configuration`
2. Upload branches (or validate existing branch coordinates)
3. Run customer batch encode (replace existing if needed)
4. Run employee allocation/repair for required branches
5. Verify in Admin Territory Health
6. Verify dashboard and employee mapping views

## Admin Operations

### Territory health endpoint
- `GET /api/v1/admin/territory-health`

Per branch fields include:
- `is_grid_generated`
- `needs_repair`
- `repair_reason`
- `assigned_pockets_count`

Current repair reason constants:
- `MISSING_TIER2_GRID`
- `MISSING_PERSISTED_5KM_LAYOUT`
- `GHOST_DATA_DETECTED`

### Repair actions
- Per-branch: "Repair Branch"
- Bulk invalid: "Repair All Invalid Branches"
- Global: "Run Global Territory Sync"

### Master tile viewer
- `GET /api/v1/admin/grid-cells`
- UI route: `/admin/grid-cells`

## Key API Areas
- `POST /api/v1/batch/encode`
- `GET /api/v1/batch/status/:jobId`
- `GET /api/v1/batch/territories/:branchId`
- `POST /api/v1/batch/territories/run-allocation/:branchId`
- `PUT /api/v1/territories/assign-manual`
- `GET /api/v1/customer-mappings`
- `GET /api/v1/admin/territory-health`
- `POST /api/v1/admin/batch-reallocate-all`

## Troubleshooting

### Internal Server Error on API calls
Common cause: backend cannot reach Postgres configured at `localhost:5434`.

Fix:
1. Ensure Docker Desktop is running.
2. Start DB + Redis:
   - `docker-compose up -d postgres redis`
3. Verify:
   - `http://localhost:3000/health`

### Batch job fails with file path errors
If worker logs show mixed Windows/Linux paths, restart:
- backend process
- `python-worker` container

### 429 Too Many Requests
Retry after short wait. In development, localhost traffic is relaxed, but burst requests can still trigger transient limits in some flows.

### Distance values look unrealistic
Re-run batch encode with current config and verify latest completed `jobId` is the one used by UI.

## Notes for Developers
- Canonical pocket IDs are enforced and legacy `w...` codes are migrated/cleaned.
- Keep config origin/alphabet changes controlled; they directly affect pocket assignment.
- For large refactors, preserve backup blocks using `// --- ORIGINAL BACKUP ---` in JS/TS files as per project convention.
