# Branch Upload Troubleshooting Guide

## Issue: Upload Stuck at "Parsing Excel file... 0%"

### Root Cause
The branch upload uses an **asynchronous job queue** (Bull + Redis) similar to batch processing. If uploads are stuck at 0%, it means:

1. **Redis is not running** - The job queue requires Redis
2. **Worker process is not running** - Jobs are queued but not processed
3. **Redis connection failed** - Backend can't connect to Redis

---

## Solution Steps

### 1. Check if Redis is Running

**Windows (Docker Desktop)**:
```powershell
docker ps | findstr redis
```

**Expected Output**:
```
CONTAINER ID   IMAGE          STATUS
abc123def456   redis:alpine   Up 5 minutes
```

**If Redis is not running**:
```powershell
# Start Redis container
docker-compose up -d redis

# Or start all services
docker-compose up -d
```

### 2. Check Redis Connection

**Test Redis connection**:
```powershell
# From backend directory
cd backend
npm run test:redis
```

**Or manually test**:
```powershell
docker exec -it <redis-container-id> redis-cli ping
```

**Expected Output**: `PONG`

### 3. Check Backend Logs

**Look for worker startup**:
```powershell
# Check backend logs
docker-compose logs backend | findstr "worker"
```

**Expected Output**:
```
backend_1  | Branch upload worker started
backend_1  | Batch process worker started
```

### 4. Check Job Queue Status

**Monitor Redis queue**:
```powershell
# Connect to Redis CLI
docker exec -it <redis-container-id> redis-cli

# Check queued jobs
KEYS bull:branch-upload:*

# Check job details
HGETALL bull:branch-upload:<job-id>
```

### 5. Restart Backend Service

**If worker isn't running**:
```powershell
# Restart backend to reload workers
docker-compose restart backend

# Or restart all services
docker-compose restart
```

---

## How Branch Upload Works (Same as Batch Processing)

### Architecture
```
Frontend → Backend API → Redis Queue → Worker Process → Database
```

### Flow
1. **Frontend**: Uploads Excel file to `/api/v1/branches/upload`
2. **Backend API**: 
   - Receives file
   - Creates job in Redis queue
   - Returns job ID immediately (202 Accepted)
3. **Worker Process**:
   - Picks up job from queue
   - Parses Excel file
   - Validates data
   - Calculates Pocket IDs
   - Inserts into database
   - Updates job progress (0% → 100%)
4. **Frontend**:
   - Polls `/api/v1/jobs/<job-id>` every second
   - Updates progress bar
   - Shows completion message

### Progress Stages
- **0-10%**: Parsing Excel file
- **10-80%**: Validating rows and calculating Pocket IDs
- **80-100%**: Inserting branches into database

---

## Quick Fix Commands

### Start Everything
```powershell
# From project root
docker-compose up -d
```

### Check All Services
```powershell
docker-compose ps
```

### View Live Logs
```powershell
# All services
docker-compose logs -f

# Just backend
docker-compose logs -f backend

# Just Redis
docker-compose logs -f redis
```

### Restart Backend Only
```powershell
docker-compose restart backend
```

---

## Configuration Check

### Backend Environment Variables
Check `backend/.env`:
```env
REDIS_HOST=redis
REDIS_PORT=6379
```

### Docker Compose
Check `docker-compose.yml`:
```yaml
services:
  backend:
    environment:
      - REDIS_HOST=redis
      - REDIS_PORT=6379
    depends_on:
      - redis
  
  redis:
    image: redis:alpine
    ports:
      - "6379:6379"
```

---

## Testing Upload Manually

### 1. Create Test Excel File
Create `test-branches.xlsx` with:
```
| ID    | City        | Latitude | Longitude  |
|-------|-------------|----------|------------|
| BR001 | New York    | 40.7128  | -74.0060   |
| BR002 | Los Angeles | 34.0522  | -118.2437  |
| BR003 | Chicago     | 41.8781  | -87.6298   |
```

### 2. Upload via API
```powershell
# Using curl
curl -X POST http://localhost:3000/api/v1/branches/upload `
  -F "file=@test-branches.xlsx"
```

**Expected Response**:
```json
{
  "message": "Upload queued for processing",
  "jobId": "uuid-here",
  "status": "queued",
  "statusUrl": "/api/v1/jobs/uuid-here"
}
```

### 3. Check Job Status
```powershell
curl http://localhost:3000/api/v1/jobs/<job-id>
```

**Expected Response (Processing)**:
```json
{
  "id": "uuid-here",
  "status": "active",
  "progress": 45,
  "data": { ... }
}
```

**Expected Response (Complete)**:
```json
{
  "id": "uuid-here",
  "status": "completed",
  "progress": 100,
  "result": {
    "success": true,
    "summary": {
      "total": 3,
      "inserted": 3,
      "skipped": 0,
      "errors": 0
    }
  }
}
```

---

## Common Issues

### Issue 1: "ECONNREFUSED" Error
**Cause**: Redis is not running  
**Solution**: Start Redis with `docker-compose up -d redis`

### Issue 2: Jobs Stay in "waiting" Status
**Cause**: Worker process not running  
**Solution**: Restart backend with `docker-compose restart backend`

### Issue 3: "Job not found" Error
**Cause**: Job expired or Redis was restarted  
**Solution**: Upload file again

### Issue 4: Upload Timeout
**Cause**: Large file or slow processing  
**Solution**: 
- Check backend logs for errors
- Increase timeout in frontend (currently 2 minutes)
- Process smaller batches

---

## Comparison: Branch Upload vs Batch Processing

Both use the **same architecture**:

| Feature | Branch Upload | Batch Processing |
|---------|--------------|------------------|
| Queue Name | `branch-upload` | `batch-process` |
| Worker File | `branchUploadWorker.js` | (inline in batch route) |
| Endpoint | `/api/v1/branches/upload` | `/api/v1/batch/encode` |
| Progress Tracking | ✅ Yes (0-100%) | ✅ Yes (0-100%) |
| Async Processing | ✅ Yes | ✅ Yes |
| Job Status API | ✅ `/api/v1/jobs/:id` | ✅ `/api/v1/jobs/:id` |

---

## Status Check Script

Create `check-upload-status.ps1`:
```powershell
# Check if Redis is running
Write-Host "Checking Redis..." -ForegroundColor Yellow
docker ps | findstr redis

# Check backend logs for worker
Write-Host "`nChecking Backend Worker..." -ForegroundColor Yellow
docker-compose logs backend | Select-String "worker" | Select-Object -Last 5

# Check Redis keys
Write-Host "`nChecking Redis Queue..." -ForegroundColor Yellow
docker exec $(docker ps -q -f name=redis) redis-cli KEYS "bull:branch-upload:*"

Write-Host "`nDone!" -ForegroundColor Green
```

Run with:
```powershell
.\check-upload-status.ps1
```

---

## Next Steps

1. Run the status check script
2. Ensure Redis is running
3. Restart backend if needed
4. Try uploading again
5. Check browser console for detailed logs
6. Check backend logs if still failing

The upload functionality IS working the same as batch processing - it just needs Redis and the worker to be running!
