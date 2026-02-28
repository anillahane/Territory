# Project Review

## Executive Summary

This repository has strong breadth (backend APIs, frontend app shell, queue/worker infrastructure, and extensive documentation), but it is currently blocked from a reliable local developer workflow because core validation commands fail in default conditions.

Overall assessment: **Good architecture direction, medium implementation risk, high delivery risk until build/lint startup issues are resolved.**

## What Looks Good

- Backend test suite includes substantial unit/property coverage and demonstrates mature service-level validation patterns.
- The system architecture is clearly documented and split across backend, frontend, and worker services.
- Security fundamentals are present in the API (Helmet, CORS control, rate limiting, centralized error handling).

## High-Priority Findings

### 1) Backend graceful shutdown bug (runtime reliability)

In `backend/src/app.js`, the code calls `app.close()` inside the `SIGTERM` handler. `app` is an Express application instance and does not expose `.close()`; only the object returned by `app.listen(...)` supports it. This can break graceful shutdown in production or containerized deployments.

**Recommendation:** assign `const server = app.listen(...)` and call `server.close(...)` in shutdown handlers.

### 2) Backend linting is configured in scripts but not usable out of the box

`backend/package.json` defines `npm run lint`, but running it fails because no ESLint config is present in backend scope.

**Recommendation:** add an ESLint config (`eslint.config.js` or `.eslintrc.*`) in `backend/`, and align with the script globs already defined.

### 3) Frontend does not currently compile

`npm run build` in `frontend/` fails with TypeScript errors (unused imports/variables, type narrowing issues, and missing `ImportMeta.env` typing).

**Recommendation:**
- Resolve existing TS compile errors in listed files.
- Add/verify `vite-env.d.ts` (or equivalent typing declarations) for `ImportMeta.env`.
- Consider enabling incremental CI checks per module to prevent regression.

### 4) Documentation drift vs executable scripts

Root README references backend commands that do not exist exactly as documented (e.g., `test:coverage` in backend scripts), and project status claims may not match current build reality.

**Recommendation:** make README command examples script-accurate and add a small “known issues” section while frontend compile errors are being resolved.

## Medium-Priority Findings

- Repository contains `node_modules` directories in working tree for backend/frontend. Even if ignored, this can increase local noise and confusion.
- Long-running backend tests appear to trigger repetitive queue/Redis error logs when dependent services are not running, which obscures signal.

**Recommendation:** add test-mode guards for optional queue initialization and/or dependency mocks to reduce noisy output.

## Suggested 7-Day Stabilization Plan

1. **Day 1–2:** Fix backend shutdown handling and add backend ESLint config.
2. **Day 2–4:** Clear frontend TypeScript build errors and confirm `npm run build` passes.
3. **Day 4–5:** Align README scripts/status with actual runnable commands.
4. **Day 5–7:** Add CI gates: backend lint + test, frontend lint + build, worker smoke check.

## Validation Performed For This Review

- Executed backend lint command (fails due to missing ESLint config).
- Executed backend tests (tests start and many pass, but run produced persistent queue/Redis error noise and was terminated).
- Executed frontend build (fails with TypeScript compile errors).

