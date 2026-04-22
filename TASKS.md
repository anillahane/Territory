# Territory Redesign Task Tracker

Statuses:
- `⬜` not started
- `🔄` in progress
- `✅` done
- `⚠️` blocked

## P0 — Security & Data Integrity

| # | Status | Task | Scope | Change |
| --- | --- | --- | --- | --- |
| 1 | ✅ | Authentication & Authorization ([PR #1](https://github.com/anillahane/Territory/pull/1)) | `backend/src/app.js`, new `backend/src/middleware/auth.js`, all routes under `backend/src/routes/*`, `frontend/src/App.tsx`, new `frontend/src/pages/Login.tsx`, `frontend/src/services/api.ts`, `.env.example`, `docker-compose.yml` | Introduce JWT-based auth (or Auth0/Clerk if budget allows). Add `requireAuth` + `requireRole('admin')` middleware. Protect every mutating endpoint; mark `/config`, `/branches/*`, `/customer-mappings DELETE`, `/jobs/*` admin-only. Add login page, token storage, axios interceptor attaching `Authorization: Bearer`. `401` → redirect to login. |
| 2 | ✅ | Secure File Upload Validation ([PR #2](https://github.com/anillahane/Territory/pull/2)) | `backend/src/routes/branches.js`, `backend/src/routes/batch.js`, new `backend/src/utils/fileValidation.js` | Add magic-byte check (`file-type` package), stricter MIME whitelist, per-request size cap (10 MB), row-count cap (100k rows), filename sanitization, virus-scan stub hook. |
| 3 | ✅ | Atomic Mapping Persistence ([PR #3](https://github.com/anillahane/Territory/pull/3)) | `backend/src/services/MappingService.js`, `backend-worker/worker.py` | Wrap the full batch insert in a single transaction; add `ON CONFLICT (customer_id) DO UPDATE`; stream 1000-row batches inside one txn with `SAVEPOINT` for partial failures. |
| 4 | ✅ | Scoped `replaceExisting` ([PR #4](https://github.com/anillahane/Territory/pull/4)) | `backend/src/routes/batch.js`, `backend-worker/worker.py`, `backend/src/workers/branchUploadWorker.js` | Both Node and Python workers currently `DELETE FROM customer_pocket_mappings` unconditionally when `replaceExisting=true`. Scope deletion to the branches referenced in the incoming file, and require an admin role + explicit `confirmWipeAll` flag for global wipe. |
| 5 | ✅ | Database Pool Hardening ([PR #5](https://github.com/anillahane/Territory/pull/5)) | `backend/src/config/database.js`, `docker-compose.yml`, `backend/.env.example` | Remove hardcoded `postgres` password fallback. Replace `pool.on('error') -> process.exit(-1)` with retry + structured log + health-endpoint flag. Add connection limits, statement timeout, idle timeout. |

## P1 — Performance & Correctness

| # | Status | Task | Scope | Change |
| --- | --- | --- | --- | --- |
| 6 | ✅ | PostGIS Nearest-Branch ([PR #6](https://github.com/anillahane/Territory/pull/6)) | `backend/src/routes/nearest.js`, `backend/src/services/NearestService.js` | Replace JS Haversine loop (`O(N×M)`) with `ORDER BY branches.geom <-> ST_MakePoint($lon,$lat)::geography LIMIT k`. GIST index already exists. |
| 7 | ✅ | Territory Visualization Caching ([PR #7](https://github.com/anillahane/Territory/pull/7)) | `backend/src/routes/batch.js` (`GET /batch/territories/visualization`), new `backend/src/services/TerritoryCache.js` | Cache rendered Voronoi GeoJSON in Redis with a key derived from `{jobId, mode, branchIds, customerView, config.version}`. TTL 1h. Invalidate on new job or config change. |
| 8 | ✅ | Frontend Route Lazy-Loading ([PR #8](https://github.com/anillahane/Territory/pull/8)) | `frontend/src/App.tsx`, `vite.config.ts` | `React.lazy` all 6 route pages; `Suspense` fallback; split vendor chunks for MUI and MapLibre. |
| 9 | ✅ | Server-Side Pagination ([PR #9](https://github.com/anillahane/Territory/pull/9)) | `frontend/src/pages/Branches.tsx`, `backend/src/routes/branches.js` | Remove `limit: 1000` client-side fetch; switch to `@mui/x-data-grid` server-mode pagination (`paginationMode="server"`). Backend already supports `limit/offset`. |
| 10 | ✅ | SSE/WebSocket Replaces Polling ([PR #10](https://github.com/anillahane/Territory/pull/10)) | `backend/src/routes/jobs.js` (add SSE endpoint), `frontend/src/pages/BatchProcessing.tsx`, `frontend/src/pages/Jobs.tsx` | Replace 2-second `setInterval` polling with Server-Sent Events stream pushing job progress updates. Fall back to polling when `EventSource` unavailable. |

## P2 — Architecture & Maintainability

| # | Status | Task | Scope | Change |
| --- | --- | --- | --- | --- |
| 11 | ✅ | Split Dashboard God Component ([PR #11](https://github.com/anillahane/Territory/pull/11)) | `frontend/src/pages/Dashboard.tsx` → multiple files under `frontend/src/features/dashboard/` | Extract `MapContainer`, `GridOverlayLayer`, `BranchLayer`, `CustomerLayer`, `TerritoryLayer`, `MapControls`, `useMapInstance` hook. Debounce grid regeneration on pan/zoom. |
| 12 | ✅ | DataState Component ([PR #12](https://github.com/anillahane/Territory/pull/12)) | new `frontend/src/components/DataState.tsx`, all page files under `frontend/src/pages/` | Wrap loading/empty/error states into one component. Removes duplicated `if (loading)... if (error)... if (empty)...` across pages. |
| 13 | ✅ | Service Layer Extraction ([PR #13](https://github.com/anillahane/Territory/pull/13)) | split `backend/src/routes/batch.js` into routes + `backend/src/services/BatchService.js`, `VoronoiService.js` | Routes become thin (`parse req -> call service -> respond`). Services are unit-testable and don't know about Express. |
| 14 | ⬜ | Unified Job Status | new `backend/src/services/JobStatusService.js`, `backend/src/routes/jobs.js`, `backend/src/routes/batch.js`, frontend job pages | Consolidate to one authoritative state machine driven by the Postgres table; Bull state is an internal detail. |
| 15 | ⬜ | Fix Hand-Rolled IST Formatting | `frontend/src/pages/BatchProcessing.tsx`, new `frontend/src/utils/datetime.ts` | Replace manual IST offset math with `date-fns-tz formatInTimeZone(date, 'Asia/Kolkata', 'dd MMM yyyy HH:mm:ss')`. |
| 16 | ⬜ | Accessibility Pass | all files under `frontend/src/pages/` and `frontend/src/components/` | Add `aria-labels` on `IconButton`-only controls, keyboard focus management in dialogs, `role="status"` on loading regions, color contrast audit. |

## P3 — Developer Experience & Observability

| # | Status | Task | Scope | Change |
| --- | --- | --- | --- | --- |
| 17 | ⬜ | TanStack Query Migration | `frontend/src/services/api.ts`, all page files; `frontend/src/App.tsx` | Replace ad-hoc `useEffect + useState` fetching with TanStack Query hooks. |
| 18 | ⬜ | OpenTelemetry + Sentry | `backend/src/app.js`, new `backend/src/utils/tracing.js`, `backend-worker/worker.py`, `frontend/src/main.tsx` | Auto-instrument Express/pg/ioredis/axios. Send traces to OTLP collector; errors to Sentry. Frontend: browser SDK with session replay. |
| 19 | ⬜ | BullMQ + Bull Board | migrate `backend/src/config/queue.js` from bull to bullmq; mount Bull Board UI at `/admin/queues` | BullMQ is the maintained successor; Bull Board gives an admin UI for job inspection/retry. |
| 20 | ⬜ | Frontend Testing | add Vitest + React Testing Library; create `frontend/src/**/__tests__/*.test.tsx` | Initial coverage for stores (`useStore` slices), utils (`datetime`, `validation`), and critical components (`Dashboard` compose, `BatchProcessing` upload flow). |
| 21 | ⬜ | Remove `console.log` / `any` | all `.ts` and `.tsx` files in frontend | Replace console logs with a logger util. Replace loose `any` types in `services/api.ts` with DTOs generated from backend Joi schemas. |

## P4 — Ops & Hygiene

| # | Status | Task | Scope | Change |
| --- | --- | --- | --- | --- |
| 22 | ⬜ | API Docs (OpenAPI/Swagger) | new `backend/src/docs/openapi.yaml`, mount `/api/docs` with `swagger-ui-express` | Generate an OpenAPI 3.0 spec covering every route under `backend/src/routes/*`. |
| 23 | ⬜ | Rate Limit & CORS Hardening | `backend/src/app.js` | Replace blanket rate limit with per-route tiers. Tighten CORS via explicit `ALLOWED_ORIGINS`. Add stricter Helmet CSP. |
| 24 | ⬜ | Docs & Ops Script Cleanup | repo root markdown files and `scripts/` directory | Consolidate duplicate docs, move history under `docs/history/`, delete empties, audit scripts. |
| 25 | ⬜ | CI Hardening | `.github/workflows/ci.yml`, add `.github/workflows/deploy.yml` | Fail on high vulnerabilities, add image scanning, Dependabot, and real deploy workflow or remove stubs. |

## Progress Summaries

- None yet.

## Deferred Rows Added During Execution

- None yet.
