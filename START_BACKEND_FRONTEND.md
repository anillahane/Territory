# Starting Backend and Frontend

## Issue
The backend and frontend containers are not running, causing "timeout" and "Network Error" issues.

## Solution

### Option 1: Start with Docker Compose (Recommended)
```powershell
# Navigate to project root
cd "C:\MIS\Territory Redesign"

# Start all services
docker-compose up -d

# Check status
docker-compose ps
```

### Option 2: Start Backend and Frontend Separately

#### Start Backend
```powershell
cd backend
npm install  # If not already installed
npm start
```

#### Start Frontend (in another terminal)
```powershell
cd frontend
npm install  # If not already installed
npm run dev
```

### Option 3: Use the PowerShell Start Script
```powershell
.\start-with-docker.ps1
```

## Verify Services are Running

### Check Docker Containers
```powershell
docker ps
```

You should see:
- `location-pockets-db` (PostgreSQL)
- `location-pockets-redis` (Redis)
- Backend container (if using Docker)
- Frontend container (if using Docker)

### Check Backend
Open browser: http://localhost:3000/health

Should return:
```json
{
  "status": "ok",
  "timestamp": "..."
}
```

### Check Frontend
Open browser: http://localhost:5173

Should show the Location Pockets application.

## Current Status
Based on `docker ps -a`, only these are running:
- ✅ location-pockets-redis (port 6379)
- ✅ location-pockets-db (port 5434)
- ❌ Backend (port 3000) - NOT RUNNING
- ❌ Frontend (port 5173) - NOT RUNNING

## What to Do Now

1. **Start the backend**:
   ```powershell
   cd backend
   npm start
   ```

2. **Start the frontend** (in another terminal):
   ```powershell
   cd frontend
   npm run dev
   ```

3. **Verify both are running**:
   - Backend: http://localhost:3000/health
   - Frontend: http://localhost:5173

4. **Try uploading a file again** in the Batch Processing page

## Troubleshooting

### Backend won't start
- Check if port 3000 is already in use
- Check backend logs for errors
- Verify database connection (port 5434)
- Verify Redis connection (port 6379)

### Frontend won't start
- Check if port 5173 is already in use
- Check frontend logs for errors
- Verify backend is running first

### Still getting timeout errors
- Verify backend is accessible: `curl http://localhost:3000/health`
- Check firewall settings
- Check if VITE_API_URL is set correctly in frontend/.env
