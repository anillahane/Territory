# Territory

Territory is a full-stack application for branch management, pocket ID generation, nearest-branch lookup, and batch customer processing.

## Repository Layout

- `backend/` Express API, workers, migrations, and Jest tests
- `frontend/` React + TypeScript client
- `docs/` active reference material plus archived project history
- `docker-compose.yml` local container workflow
- `TASKS.md` delivery tracker used for the redesign work

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

## Verification

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

## API Entry Points

- Base API: `http://localhost:3000/api/v1`
- Health: `GET /health`
- Swagger UI: `GET /api/v1/docs`
- OpenAPI YAML: `GET /api/v1/docs/openapi.yaml`

## Documentation

- [docs/README.md](docs/README.md) documentation index
- [docs/operations.md](docs/operations.md) setup, Docker, and helper script guidance
- [docs/batch-processing.md](docs/batch-processing.md) batch upload and queue workflow
- [docs/technical-documentation.md](docs/technical-documentation.md) deeper system reference
- [docs/migration-performance-playbook.md](docs/migration-performance-playbook.md) migration and performance guidance
- [docs/history/README.md](docs/history/README.md) archived status notes, fix summaries, and superseded guides

## Helper Scripts

There is currently no dedicated `scripts/` directory. Operational helper scripts live at the repository root, including:

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
