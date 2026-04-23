# Operations Guide

This is the current source of truth for local setup and day-to-day repo operations.

## Requirements

- Node.js 20+
- npm 10+
- PostgreSQL with PostGIS for backend integration tests and local API work
- Redis for queued batch processing outside test mode
- Docker and Docker Compose if you want the containerized workflow

## Local Development

Backend:

```bash
cd backend
npm install
cp .env.example .env
npm run migrate
npm run dev
```

Frontend:

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

## Verification Commands

Backend:

```bash
cd backend
npm run lint
npm test
```

Frontend:

```bash
cd frontend
npm run lint
npm test
npm run build
```

## Docker Workflow

The repository currently exposes `docker-compose.yml` at the root.

Typical usage:

```bash
docker-compose up -d
docker-compose exec backend npm run migrate
```

## Helper Scripts

There is no dedicated `scripts/` directory in the current repo. The active helper scripts live at the repository root:

- `start.sh`
- `start.ps1`
- `start-all.ps1`
- `start-with-docker.ps1`
- `start-python-worker.ps1`
- `stop-all.ps1`
- `check-hybrid-setup.ps1`
- `monitor-batch-job.ps1`
- `push-pending-job.ps1`
- `test-system-status.ps1`

Keep new operational scripts close to this list or move them into a future `scripts/` directory intentionally instead of creating more one-off locations.
