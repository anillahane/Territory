# Docker Setup Guide for Windows

## Step-by-Step Docker Installation and Configuration

---

## Part 1: Install Docker Desktop

### 1.1 Download Docker Desktop
- Go to: https://www.docker.com/products/docker-desktop/
- Click "Download for Windows"
- Wait for the installer to download (approximately 500MB)

### 1.2 Install Docker Desktop
1. Run the installer (`Docker Desktop Installer.exe`)
2. Follow the installation wizard
3. **Important:** Enable WSL 2 when prompted (recommended)
4. Complete the installation
5. **Restart your computer** when prompted

### 1.3 Start Docker Desktop
1. Launch Docker Desktop from Start Menu
2. Wait for Docker to start (you'll see a whale icon in system tray)
3. Accept the Docker Subscription Service Agreement if prompted
4. Skip the tutorial (optional)

### 1.4 Verify Installation
Open PowerShell and run:
```powershell
docker --version
docker-compose --version
```

You should see version numbers like:
```
Docker version 24.x.x
Docker Compose version v2.x.x
```

---

## Part 2: Configure Docker for Your Project

### 2.1 Check Docker is Running
```powershell
docker ps
```

If you see a table (even if empty), Docker is running correctly.

### 2.2 Navigate to Your Project
```powershell
cd path\to\location-pockets-system
```

---

## Part 3: Start the Database and Redis

### 3.1 Start PostgreSQL and Redis Containers
```powershell
docker-compose up -d postgres redis
```

**What this does:**
- `-d` runs containers in detached mode (background)
- Starts PostgreSQL with PostGIS extension
- Starts Redis for job queue
- Creates persistent volumes for data

### 3.2 Verify Containers are Running
```powershell
docker-compose ps
```

You should see:
```
NAME                          STATUS
location-pockets-db           Up (healthy)
location-pockets-redis        Up (healthy)
```

### 3.3 Check Container Logs (if needed)
```powershell
# View all logs
docker-compose logs

# View specific service logs
docker-compose logs postgres
docker-compose logs redis

# Follow logs in real-time
docker-compose logs -f postgres
```

---

## Part 4: Set Up the Database

### 4.1 Wait for Database to be Ready
The database needs a few seconds to initialize. Check health status:
```powershell
docker-compose ps postgres
```

Wait until you see `(healthy)` in the status.

### 4.2 Run Database Migrations
```powershell
cd backend
npm run migrate
```

**Expected output:**
```
Running migrations...
✓ 001_initial_schema.sql applied successfully
Migrations completed!
```

### 4.3 Verify Database Setup (Optional)
Connect to the database to verify:
```powershell
docker exec -it location-pockets-db psql -U postgres -d location_pockets
```

Inside PostgreSQL, run:
```sql
-- List tables
\dt

-- Check PostGIS extension
SELECT PostGIS_Version();

-- Exit
\q
```

You should see tables: `config`, `branches`, `config_history`

---

## Part 5: Start the Backend

### 5.1 Create Environment File
Create `backend/.env` file:
```powershell
cd backend
```

Create `.env` with this content:
```env
NODE_ENV=development
PORT=3000

# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=location_pockets
DB_USER=postgres
DB_PASSWORD=postgres

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# CORS
CORS_ORIGIN=http://localhost:5173
```

### 5.2 Start Backend Server
```powershell
npm run dev
```

**Expected output:**
```
> nodemon src/app.js

[INFO] Server starting...
[INFO] Database connected successfully
[INFO] Redis connected successfully
[INFO] Server running on port 3000
```

**Keep this terminal open!**

### 5.3 Test Backend API
Open a new PowerShell window and test:
```powershell
# Test health endpoint
curl http://localhost:3000/api/v1/health

# Test config endpoint
curl http://localhost:3000/api/v1/config
```

You should get JSON responses.

---

## Part 6: Start the Frontend

### 6.1 Open New Terminal
Open a new PowerShell window (keep backend running in the first one)

### 6.2 Navigate to Frontend
```powershell
cd path\to\location-pockets-system\frontend
```

### 6.3 Install Dependencies (if not done)
```powershell
npm install
```

### 6.4 Create Environment File
Create `frontend/.env` file:
```env
VITE_API_URL=http://localhost:3000/api/v1
```

### 6.5 Start Frontend Development Server
```powershell
npm run dev
```

**Expected output:**
```
VITE v5.x.x  ready in xxx ms

➜  Local:   http://localhost:5173/
➜  Network: use --host to expose
```

---

## Part 7: Access the Application

### 7.1 Open Your Browser
Navigate to: **http://localhost:5173**

### 7.2 Test the Application
1. **Configuration Page** - Set origin point and alphabet
2. **Calculator Page** - Encode/decode Pocket IDs
3. Check browser console for any errors (F12)

---

## Part 8: Common Commands

### Start Everything
```powershell
# Terminal 1: Start Docker services
docker-compose up -d postgres redis

# Terminal 2: Start backend
cd backend
npm run dev

# Terminal 3: Start frontend
cd frontend
npm run dev
```

### Stop Everything
```powershell
# Stop backend and frontend: Press Ctrl+C in their terminals

# Stop Docker containers
docker-compose down

# Stop and remove volumes (WARNING: deletes data)
docker-compose down -v
```

### Restart Services
```powershell
# Restart specific service
docker-compose restart postgres
docker-compose restart redis

# Restart all services
docker-compose restart
```

### View Logs
```powershell
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f postgres
docker-compose logs -f redis
```

### Check Status
```powershell
# Container status
docker-compose ps

# Resource usage
docker stats
```

---

## Part 9: Troubleshooting

### Problem: Docker Desktop won't start
**Solution:**
1. Restart computer
2. Check Windows features: Enable "Virtual Machine Platform" and "Windows Subsystem for Linux"
3. Update Windows to latest version
4. Reinstall Docker Desktop

### Problem: Port already in use
**Error:** `Port 5432 is already allocated`

**Solution:**
```powershell
# Find what's using the port
netstat -ano | findstr :5432

# Kill the process (replace PID with actual process ID)
taskkill /PID <PID> /F

# Or change port in docker-compose.yml
```

### Problem: Database connection failed
**Solution:**
```powershell
# Check if container is running
docker-compose ps postgres

# Check logs
docker-compose logs postgres

# Restart container
docker-compose restart postgres

# Wait for healthy status
docker-compose ps postgres
```

### Problem: Migrations fail
**Solution:**
```powershell
# Ensure database is ready
docker-compose ps postgres

# Check database logs
docker-compose logs postgres

# Try running migrations again
cd backend
npm run migrate

# If still failing, reset database
docker-compose down -v
docker-compose up -d postgres redis
# Wait 10 seconds
npm run migrate
```

### Problem: Backend can't connect to database
**Solution:**
1. Check `.env` file exists in `backend/` folder
2. Verify database credentials match docker-compose.yml
3. Ensure `DB_HOST=localhost` (not `postgres` when running locally)
4. Restart backend server

### Problem: Frontend can't connect to backend
**Solution:**
1. Check backend is running on port 3000
2. Verify `.env` file in `frontend/` folder
3. Check `VITE_API_URL=http://localhost:3000/api/v1`
4. Check browser console for CORS errors
5. Restart frontend dev server

---

## Part 10: Development Workflow

### Daily Startup
```powershell
# 1. Start Docker Desktop (if not running)

# 2. Start services
docker-compose up -d postgres redis

# 3. Start backend (Terminal 1)
cd backend
npm run dev

# 4. Start frontend (Terminal 2)
cd frontend
npm run dev

# 5. Open browser: http://localhost:5173
```

### Daily Shutdown
```powershell
# 1. Stop backend and frontend (Ctrl+C in terminals)

# 2. Stop Docker containers
docker-compose down

# 3. Close Docker Desktop (optional)
```

### Running Tests
```powershell
# Unit tests (no Docker needed)
cd backend
npm test

# Integration tests (needs Docker)
docker-compose up -d postgres redis
npm run test:integration
```

---

## Part 11: Docker Compose Services Overview

### Services in docker-compose.yml

1. **postgres** (PostgreSQL + PostGIS)
   - Port: 5432
   - Database: location_pockets
   - User: postgres
   - Password: postgres
   - Volume: postgres_data (persistent)

2. **redis** (Redis)
   - Port: 6379
   - Volume: redis_data (persistent)

3. **backend** (Node.js API) - Optional
   - Port: 3000
   - Auto-reload on code changes
   - Depends on postgres and redis

4. **frontend** (React + Vite) - Optional
   - Port: 5173
   - Auto-reload on code changes
   - Depends on backend

### Running Full Stack with Docker
```powershell
# Start everything with Docker
docker-compose up -d

# View logs
docker-compose logs -f

# Stop everything
docker-compose down
```

**Note:** For development, it's often better to run backend and frontend locally (not in Docker) for faster reload times.

---

## Part 12: Data Persistence

### Where is data stored?
Docker volumes store data persistently:
- `postgres_data` - Database tables and data
- `redis_data` - Redis cache and job queue

### View volumes
```powershell
docker volume ls
```

### Backup database
```powershell
docker exec location-pockets-db pg_dump -U postgres location_pockets > backup.sql
```

### Restore database
```powershell
docker exec -i location-pockets-db psql -U postgres location_pockets < backup.sql
```

### Reset everything (WARNING: deletes all data)
```powershell
docker-compose down -v
docker-compose up -d postgres redis
cd backend
npm run migrate
```

---

## Part 13: Next Steps After Docker Setup

Once Docker is running successfully:

1. ✅ Test Configuration page - Save settings
2. ✅ Test Calculator page - Encode/decode coordinates
3. 🚧 Implement Branches page
4. 🚧 Implement Dashboard/Map page
5. 🚧 Implement Batch Processing page
6. ✅ Run integration tests
7. 📝 Add API documentation

---

## Quick Reference Card

```powershell
# Start services
docker-compose up -d postgres redis

# Check status
docker-compose ps

# View logs
docker-compose logs -f

# Stop services
docker-compose down

# Start backend
cd backend; npm run dev

# Start frontend
cd frontend; npm run dev

# Run tests
cd backend; npm test

# Run migrations
cd backend; npm run migrate
```

---

## Support

If you encounter issues:
1. Check Docker Desktop is running (whale icon in system tray)
2. Check container logs: `docker-compose logs`
3. Restart containers: `docker-compose restart`
4. Check this guide's troubleshooting section
5. Review `SETUP_GUIDE.md` and `WINDOWS_GUIDE.md`

---

**Last Updated:** February 27, 2025
