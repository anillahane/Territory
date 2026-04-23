# Docker Setup Checklist

Use this checklist to ensure Docker is properly set up and integrated into your workflow.

---

## ☑️ Pre-Installation Checklist

- [ ] Windows 10/11 (64-bit) Pro, Enterprise, or Education
- [ ] At least 4GB RAM available
- [ ] At least 20GB free disk space
- [ ] Administrator access to your computer
- [ ] Stable internet connection

---

## ☑️ Installation Checklist

### 1. Download and Install Docker Desktop

- [ ] Downloaded Docker Desktop from https://www.docker.com/products/docker-desktop/
- [ ] Ran the installer
- [ ] Enabled WSL 2 during installation (if prompted)
- [ ] Completed installation
- [ ] Restarted computer
- [ ] Started Docker Desktop from Start Menu
- [ ] Accepted Docker Subscription Service Agreement
- [ ] Docker whale icon visible in system tray

### 2. Verify Docker Installation

Open PowerShell and run these commands:

- [ ] `docker --version` shows version number
- [ ] `docker-compose --version` shows version number
- [ ] `docker ps` shows empty table (no errors)
- [ ] Docker Desktop shows "Engine running" status

---

## ☑️ Project Setup Checklist

### 3. Navigate to Project

- [ ] Opened PowerShell
- [ ] Navigated to project directory: `cd path\to\location-pockets-system`
- [ ] Verified `docker-compose.yml` file exists

### 4. Start Docker Services

- [ ] Ran: `docker-compose up -d postgres redis`
- [ ] Waited for containers to start (30-60 seconds)
- [ ] Ran: `docker-compose ps`
- [ ] Verified both services show "Up (healthy)" status

### 5. Set Up Backend

- [ ] Navigated to backend: `cd backend`
- [ ] Created `.env` file (or copied from `.env.example`)
- [ ] Verified `.env` contains correct database credentials
- [ ] Ran: `npm run migrate`
- [ ] Migrations completed successfully
- [ ] No error messages in output

### 6. Test Database Connection

- [ ] Ran: `docker exec -it location-pockets-db psql -U postgres -d location_pockets`
- [ ] Inside psql, ran: `\dt`
- [ ] Saw tables: `config`, `branches`, `config_history`
- [ ] Ran: `SELECT PostGIS_Version();`
- [ ] PostGIS version displayed
- [ ] Exited psql: `\q`

---

## ☑️ Application Startup Checklist

### 7. Start Backend Server

- [ ] In backend directory
- [ ] Ran: `npm run dev`
- [ ] Saw "Server running on port 3000" message
- [ ] Saw "Database connected successfully" message
- [ ] Saw "Redis connected successfully" message
- [ ] No error messages in console
- [ ] Terminal stays open (server running)

### 8. Test Backend API

In a new PowerShell window:

- [ ] Ran: `curl http://localhost:3000/api/v1/health`
- [ ] Got JSON response with status "ok"
- [ ] Ran: `curl http://localhost:3000/api/v1/config`
- [ ] Got JSON response with config data

### 9. Start Frontend Server

- [ ] Opened new PowerShell window
- [ ] Navigated to frontend: `cd frontend`
- [ ] Created `.env` file with `VITE_API_URL=http://localhost:3000/api/v1`
- [ ] Ran: `npm install` (if not done before)
- [ ] Ran: `npm run dev`
- [ ] Saw "Local: http://localhost:5173/" message
- [ ] No error messages in console
- [ ] Terminal stays open (server running)

### 10. Test Application in Browser

- [ ] Opened browser to http://localhost:5173
- [ ] Application loaded successfully
- [ ] No errors in browser console (F12)
- [ ] Clicked "Configuration" in sidebar
- [ ] Configuration page loaded
- [ ] Clicked "Calculator" in sidebar
- [ ] Calculator page loaded

---

## ☑️ Functionality Testing Checklist

### 11. Test Configuration Page

- [ ] Entered origin latitude (e.g., 8.0)
- [ ] Entered origin longitude (e.g., 68.0)
- [ ] Verified alphabet field shows default alphabet
- [ ] Clicked "Save Configuration"
- [ ] Saw success message
- [ ] No errors in browser console

### 12. Test Calculator Page

**Encode Test:**
- [ ] Switched to "Encode" mode (if not already)
- [ ] Entered latitude: 12.9716
- [ ] Entered longitude: 77.5946
- [ ] Clicked "Generate Pocket ID"
- [ ] Saw Pocket ID result (e.g., "0A-1B-2C-3D-4E")
- [ ] Saw grid indices table
- [ ] Saw offset from origin values

**Decode Test:**
- [ ] Clicked "Switch to Decode"
- [ ] Entered a Pocket ID (from encode result)
- [ ] Clicked "Decode Pocket ID"
- [ ] Saw center coordinates
- [ ] Saw corner coordinates
- [ ] Saw grid indices table

### 13. Test Copy Functionality

- [ ] Clicked copy icon next to Pocket ID
- [ ] Saw "Copied to clipboard" message
- [ ] Pasted in notepad - verified correct value

---

## ☑️ Development Workflow Checklist

### 14. Daily Startup Routine

- [ ] Started Docker Desktop (if not running)
- [ ] Ran: `docker-compose up -d postgres redis`
- [ ] Verified services healthy: `docker-compose ps`
- [ ] Started backend: `cd backend; npm run dev`
- [ ] Started frontend: `cd frontend; npm run dev`
- [ ] Opened browser to http://localhost:5173

### 15. Daily Shutdown Routine

- [ ] Stopped backend (Ctrl+C in terminal)
- [ ] Stopped frontend (Ctrl+C in terminal)
- [ ] Ran: `docker-compose down`
- [ ] Closed Docker Desktop (optional)

---

## ☑️ Testing Checklist

### 16. Run Unit Tests

- [ ] Navigated to backend: `cd backend`
- [ ] Ran: `npm test`
- [ ] All 40 tests passed
- [ ] Coverage report shows 98.95%

### 17. Run Integration Tests

- [ ] Docker services running
- [ ] Ran: `npm run test:integration`
- [ ] All integration tests passed
- [ ] No database connection errors

---

## ☑️ Troubleshooting Checklist

If something doesn't work, check these:

### Docker Issues

- [ ] Docker Desktop is running (whale icon in system tray)
- [ ] Ran: `docker-compose ps` - services show "Up (healthy)"
- [ ] Checked logs: `docker-compose logs postgres`
- [ ] Checked logs: `docker-compose logs redis`
- [ ] Restarted services: `docker-compose restart`

### Backend Issues

- [ ] `.env` file exists in `backend/` folder
- [ ] Database credentials in `.env` match docker-compose.yml
- [ ] `DB_HOST=localhost` (not `postgres`)
- [ ] Migrations ran successfully
- [ ] Port 3000 not in use by another application
- [ ] Restarted backend server

### Frontend Issues

- [ ] `.env` file exists in `frontend/` folder
- [ ] `VITE_API_URL=http://localhost:3000/api/v1`
- [ ] Backend is running on port 3000
- [ ] Port 5173 not in use by another application
- [ ] Cleared browser cache
- [ ] Checked browser console for errors
- [ ] Restarted frontend server

### Database Issues

- [ ] PostgreSQL container is running
- [ ] Container shows "healthy" status
- [ ] Migrations completed without errors
- [ ] Can connect with: `docker exec -it location-pockets-db psql -U postgres -d location_pockets`
- [ ] Tables exist: `\dt` shows config, branches, config_history

---

## ☑️ Advanced Checklist

### 18. Data Persistence

- [ ] Created test data in application
- [ ] Stopped containers: `docker-compose down`
- [ ] Started containers: `docker-compose up -d postgres redis`
- [ ] Verified data still exists

### 19. Backup and Restore

- [ ] Created backup: `docker exec location-pockets-db pg_dump -U postgres location_pockets > backup.sql`
- [ ] Verified backup file exists and has content
- [ ] Tested restore (optional): `docker exec -i location-pockets-db psql -U postgres location_pockets < backup.sql`

### 20. Performance Check

- [ ] Ran: `docker stats`
- [ ] Verified CPU and memory usage is reasonable
- [ ] PostgreSQL using < 500MB RAM
- [ ] Redis using < 100MB RAM

---

## ☑️ Documentation Checklist

### 21. Review Documentation

- [ ] Read `DOCKER_SETUP_GUIDE.md`
- [ ] Read `WINDOWS_GUIDE.md` Docker section
- [ ] Read `SETUP_GUIDE.md`
- [ ] Bookmarked important commands

### 22. Team Onboarding

- [ ] Documented any issues encountered
- [ ] Noted any Windows-specific quirks
- [ ] Updated documentation if needed
- [ ] Shared learnings with team

---

## ☑️ Next Steps Checklist

### 23. Continue Development

- [ ] Docker environment working perfectly
- [ ] Configuration page tested
- [ ] Calculator page tested
- [ ] Ready to implement Branches page
- [ ] Ready to implement Dashboard/Map page
- [ ] Ready to implement Batch Processing page

### 24. Integration Testing

- [ ] All integration tests passing
- [ ] Can run tests with: `npm run test:integration`
- [ ] Tests create and clean up test data
- [ ] No test pollution between runs

---

## 📊 Completion Status

Count your checkmarks:

- **0-20 checked:** Just getting started
- **21-40 checked:** Making good progress
- **41-60 checked:** Almost there!
- **61-80 checked:** Excellent! Almost complete
- **81-95 checked:** Perfect! Fully set up

---

## 🎯 Quick Reference

### Essential Commands

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

### Essential URLs

- Frontend: http://localhost:5173
- Backend API: http://localhost:3000
- Health Check: http://localhost:3000/api/v1/health

---

## 🆘 Need Help?

If you're stuck:

1. ✅ Check this checklist - did you miss a step?
2. 📖 Review `DOCKER_SETUP_GUIDE.md` - detailed instructions
3. 🐛 Check troubleshooting section above
4. 📝 Review error messages carefully
5. 🔍 Search error messages online
6. 💬 Ask for help from team

---

**Last Updated:** February 27, 2025

**Status:** Ready for Docker integration ✅
