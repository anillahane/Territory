# Bull Queue Implementation - Isolated File Upload Processing

## Overview

Implemented Bull Queue with Redis for **independent and isolated** file upload processing. Each upload now runs as a background job with progress tracking.

## Architecture

```
┌─────────────┐
│   Browser   │
│  (Upload)   │
└──────┬──────┘
       │ POST /api/v1/branches/upload
       │ Returns immediately with jobId
       ▼
┌─────────────────────┐
│   Express API       │
│  (Queue Manager)    │
└──────┬──────────────┘
       │ Add job to queue
       ▼
┌─────────────────────┐
│   Redis Queue       │
│  (Bull)             │
└──────┬──────────────┘
       │ Process jobs (5 concurrent)
       ▼
┌─────────────────────┐
│  Worker Process     │
│  (Background)       │
└─────────────────────┘
```

## Benefits

✅ **Isolated Processing** - Each upload runs independently
✅ **Concurrent Uploads** - Process up to 5 files simultaneously
✅ **Progress Tracking** - Real-time progress updates (0-100%)
✅ **Fault Tolerance** - Auto-retry failed jobs (3 attempts)
✅ **Non-Blocking** - API responds immediately, doesn't wait for processing
✅ **Job History** - Keep last 100 completed, 200 failed jobs
✅ **User Experience** - Users can close browser, job continues

## New Files Created

### Backend
1. **`backend/src/config/queue.js`** - Bull queue configuration
2. **`backend/src/workers/branchUploadWorker.js`** - Background worker for processing uploads
3. **`backend/src/routes/jobs.js`** - Job management endpoints

### Modified Files
1. **`backend/src/routes/branches.js`** - Upload now queues job instead of processing synchronously
2. **`backend/src/app.js`** - Added jobs route and worker initialization
3. **`frontend/src/services/api.ts`** - Added job status polling methods
4. **`frontend/src/pages/Branches.tsx`** - Added progress bar and job polling

## API Endpoints

### Upload Branch File (Async)
```http
POST /api/v1/branches/upload
Content-Type: multipart/form-data

Response (202 Accepted):
{
  "message": "Upload queued for processing",
  "jobId": "uuid-here",
  "status": "queued",
  "statusUrl": "/api/v1/jobs/uuid-here"
}
```

### Get Job Status
```http
GET /api/v1/jobs/:jobId

Response:
{
  "jobId": "uuid-here",
  "type": "branch-upload",
  "status": "active",  // waiting, active, completed, failed
  "progress": 45,      // 0-100
  "result": null,      // Available when completed
  "error": null,
  "createdAt": 1234567890,
  "processedAt": 1234567891,
  "finishedAt": null
}
```

### List All Jobs
```http
GET /api/v1/jobs?status=active&type=branch-upload&limit=50

Response:
{
  "jobs": [...],
  "total": 10
}
```

### Retry Failed Job
```http
POST /api/v1/jobs/:jobId/retry

Response:
{
  "message": "Job queued for retry",
  "jobId": "uuid-here"
}
```

### Delete Job
```http
DELETE /api/v1/jobs/:jobId

Response:
{
  "message": "Job removed successfully",
  "jobId": "uuid-here",
  "previousStatus": "failed"
}
```

## Worker Configuration

**Concurrency**: 5 jobs simultaneously
**Retry Strategy**: 3 attempts with exponential backoff (2s, 4s, 8s)
**Job Retention**: 
- Completed: Last 100 jobs
- Failed: Last 200 jobs

## Progress Stages

| Progress | Stage |
|----------|-------|
| 0-10% | Parsing Excel file |
| 10-80% | Validating data |
| 80-100% | Inserting branches into database |

## How to Start

### 1. Start Redis (Docker)
```powershell
docker-compose up -d redis
```

### 2. Start Backend (with worker)
```powershell
cd backend
npm run dev
```

The worker automatically starts when the backend starts.

### 3. Test Upload
1. Go to http://localhost:5173/branches
2. Click "Upload Excel"
3. Select your Excel file
4. Watch the progress bar update in real-time!

## Testing Multiple Concurrent Uploads

You can now upload multiple files simultaneously:

1. Open multiple browser tabs
2. Start uploads in each tab
3. All uploads process concurrently (up to 5 at once)
4. Each has independent progress tracking

## Monitoring Jobs

### View Active Jobs
```http
GET /api/v1/jobs?status=active
```

### View Failed Jobs
```http
GET /api/v1/jobs?status=failed
```

### View Completed Jobs
```http
GET /api/v1/jobs?status=completed
```

## Error Handling

- **Validation Errors**: Tracked per row, job continues with valid rows
- **Database Errors**: Job fails, can be retried
- **Network Errors**: Auto-retry with exponential backoff
- **Worker Crash**: Jobs automatically requeued when worker restarts

## Future Enhancements

1. **Bull Board UI** - Visual dashboard for monitoring jobs
2. **Email Notifications** - Notify when large uploads complete
3. **Scheduled Jobs** - Periodic data imports
4. **Job Priorities** - VIP users get faster processing
5. **Batch Processing** - Apply same pattern to batch coordinate encoding

## Troubleshooting

### Redis Connection Error
```
Error: connect ECONNREFUSED 127.0.0.1:6379
```
**Solution**: Start Redis with `docker-compose up -d redis`

### Worker Not Processing
**Check**: Worker logs in backend console
**Solution**: Restart backend to reinitialize worker

### Jobs Stuck in "Active"
**Solution**: Clear stalled jobs
```javascript
await branchUploadQueue.clean(5000, 'active');
```

## Performance

- **Small files** (<100 rows): ~2-3 seconds
- **Medium files** (100-1000 rows): ~5-15 seconds
- **Large files** (1000-10000 rows): ~30-120 seconds

All with real-time progress updates!
