# Location Pockets System - Setup Guide

## Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** 20 LTS or higher
- **npm** 10 or higher
- **PostgreSQL** 15 with PostGIS extension
- **Redis** 7 or higher
- **Docker** and **Docker Compose** (optional, for containerized setup)
- **Git**

## Quick Start with Docker (Recommended)

The easiest way to get started is using Docker Compose:

```bash
# Clone the repository
git clone <repository-url>
cd location-pockets-system

# Start all services
docker-compose up -d

# Check service status
docker-compose ps

# View logs
docker-compose logs -f backend
```

The application will be available at:
- Frontend: http://localhost:5173
- Backend API: http://localhost:3000
- PostgreSQL: localhost:5432
- Redis: localhost:6379

## Manual Setup (Without Docker)

### 1. Database Setup

#### Install PostgreSQL with PostGIS

**On Ubuntu/Debian:**
```bash
sudo apt-get update
sudo apt-get install postgresql-15 postgresql-15-postgis-3
```

**On macOS (using Homebrew):**
```bash
brew install postgresql@15 postgis
brew services start postgresql@15
```

**On Windows:**
Download and install from https://www.postgresql.org/download/windows/
Then install PostGIS from https://postgis.net/install/

#### Create Database

```bash
# Connect to PostgreSQL
psql -U postgres

# Create database
CREATE DATABASE location_pockets;

# Connect to the database
\c location_pockets

# Enable PostGIS extension
CREATE EXTENSION postgis;

# Exit
\q
```

### 2. Redis Setup

**On Ubuntu/Debian:**
```bash
sudo apt-get install redis-server
sudo systemctl start redis-server
```

**On macOS:**
```bash
brew install redis
brew services start redis
```

**On Windows:**
Download from https://github.com/microsoftarchive/redis/releases

### 3. Backend Setup

```bash
cd backend

# Install dependencies
npm install

# Create .env file
cp .env.example .env

# Edit .env with your database credentials
nano .env

# Run migrations
npm run migrate

# Start development server
npm run dev
```

The backend API will be available at http://localhost:3000

### 4. Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Create .env file
cp .env.example .env

# Edit .env with API URL
nano .env

# Start development server
npm run dev
```

The frontend will be available at http://localhost:5173

## Environment Variables

### Backend (.env)

```env
# Server
NODE_ENV=development
PORT=3000
API_VERSION=v1

# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=location_pockets
DB_USER=postgres
DB_PASSWORD=your_password

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# Security
CORS_ORIGIN=http://localhost:5173
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=60

# File Upload
MAX_FILE_SIZE_MB=10

# Logging
LOG_LEVEL=info
```

### Frontend (.env)

```env
VITE_API_URL=http://localhost:3000/api/v1
```

## Verify Installation

### 1. Check Backend Health

```bash
curl http://localhost:3000/health
```

Expected response:
```json
{
  "status": "ok",
  "timestamp": "2025-03-02T10:00:00.000Z",
  "uptime": 123.456,
  "database": {
    "status": "connected"
  },
  "postgis": {
    "status": "available",
    "version": "3.3"
  }
}
```

### 2. Check Frontend

Open http://localhost:5173 in your browser. You should see the application interface.

### 3. Run Tests

```bash
# Backend tests
cd backend
npm test

# Frontend tests
cd frontend
npm test
```

## Common Issues

### PostgreSQL Connection Error

**Problem:** `ECONNREFUSED` or `connection refused`

**Solution:**
1. Check if PostgreSQL is running: `sudo systemctl status postgresql`
2. Verify connection settings in `.env`
3. Check PostgreSQL is listening on the correct port: `sudo netstat -plnt | grep 5432`

### PostGIS Extension Not Found

**Problem:** `ERROR: could not open extension control file`

**Solution:**
```bash
# Install PostGIS
sudo apt-get install postgresql-15-postgis-3

# Enable in database
psql -U postgres -d location_pockets -c "CREATE EXTENSION postgis;"
```

### Redis Connection Error

**Problem:** `ECONNREFUSED` to Redis

**Solution:**
1. Check if Redis is running: `redis-cli ping` (should return `PONG`)
2. Start Redis: `sudo systemctl start redis-server`

### Port Already in Use

**Problem:** `EADDRINUSE: address already in use`

**Solution:**
```bash
# Find process using the port
lsof -i :3000  # or :5173 for frontend

# Kill the process
kill -9 <PID>
```

### Migration Fails

**Problem:** Migration script errors

**Solution:**
```bash
# Drop and recreate database
psql -U postgres -c "DROP DATABASE IF EXISTS location_pockets;"
psql -U postgres -c "CREATE DATABASE location_pockets;"
psql -U postgres -d location_pockets -c "CREATE EXTENSION postgis;"

# Run migrations again
npm run migrate
```

## Development Workflow

### Starting Development

```bash
# Terminal 1: Backend
cd backend
npm run dev

# Terminal 2: Frontend
cd frontend
npm run dev

# Terminal 3: Watch tests
cd backend
npm run test:watch
```

### Making Changes

1. Create a feature branch: `git checkout -b feature/your-feature`
2. Make your changes
3. Run tests: `npm test`
4. Run linter: `npm run lint`
5. Commit: `git commit -m "feat: your feature"`
6. Push: `git push origin feature/your-feature`

### Database Migrations

To create a new migration:

1. Create a new SQL file in `backend/src/migrations/`
2. Name it with incrementing number: `002_your_migration.sql`
3. Update `run.js` to include the new migration
4. Run: `npm run migrate`

## Next Steps

1. Review the [PROJECT_PLAN.md](PROJECT_PLAN.md) for development phases
2. Check the [API Documentation](docs/API.md) (coming soon)
3. Read the [Contributing Guidelines](CONTRIBUTING.md) (coming soon)
4. Join the development team chat

## Support

For issues or questions:
- Create an issue on GitHub
- Contact the development team
- Check the documentation in `/docs`

## License

Proprietary - All rights reserved
