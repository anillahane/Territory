# Batch Processing Architecture & Best Practices

## Files Involved

### Frontend
1. **`frontend/src/pages/BatchProcessing.tsx`** - Main UI component with upload and progress tracking
2. **`frontend/src/services/api.ts`** - API client for backend communication

### Backend
1. **`backend/src/routes/batch.js`** - API endpoints and worker process
2. **`backend/src/config/queue.js`** - Bull queue configuration
3. **`backend/src/services/MappingService.js`** - Database persistence logic
4. **`backend/src/services/BranchFinderService.js`** - Branch assignment logic
5. **`backend/src/utils/geometry.js`** - Pocket ID calculation and distance functions

### Database
1. **`backend/src/migrations/003_create_customer_pocket_mappings.sql`** - Schema for storing mappings

---

## Current Architecture (Implemented)

### Flow Diagram
```
User Upload → Frontend → Backend API → Parse Excel → Queue Job → Worker Process → Database → Results
     ↓           ↓            ↓             ↓            ↓             ↓              ↓         ↓
  Select    Validate    Receive File   Read Rows   Add to Bull   Process Each   Save Data  Generate
   File      Format      (2-3 sec)     (sync)      Queue (Redis)    Row         Mappings    Excel
                                                                   (async)
```

### Step-by-Step Process

#### 1. **User Uploads File** (`BatchProcessing.tsx`)
```typescript
// Location: frontend/src/pages/BatchProcessing.tsx, line ~115
const handleUpload = async () => {
  setUploading(true);
  const response = await api.batchEncode(fileToUpload);
  
  // Response received immediately (2-3 seconds)
  setUploading(false);
  setUploadDialogOpen(false);
  
  // Start polling for progress
  startPolling(response.jobId);
}
```

**What happens:**
- User selects Excel file
- Frontend sends file to backend via multipart/form-data
- Shows "Uploading and parsing file..." spinner
- Takes 2-3 seconds (parsing time)

#### 2. **Backend Receives & Parses** (`backend/src/routes/batch.js`, line ~250)
```javascript
router.post('/encode', upload.single('file'), async (req, res) => {
  // Parse Excel file SYNCHRONOUSLY (this takes 2-3 seconds)
  const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
  const data = xlsx.utils.sheet_to_json(sheet);
  
  // Create job in database
  await query('INSERT INTO jobs ...');
  
  // Add to Bull queue (Redis)
  await batchQueue.add({ jobId, data, config, fileName });
  
  // Return immediately - don't wait for processing
  res.json({ jobId, fileName, total: data.length });
});
```

**What happens:**
- Receives file buffer
- Parses Excel to JSON (BLOCKING - takes time for large files)
- Validates data (checks for empty file)
- Creates job record in PostgreSQL
- Adds job to Redis queue
- Returns jobId to frontend

**Why synchronous parsing?**
- Need to validate file format before accepting
- Need to count rows for progress tracking
- Need to extract data for worker

#### 3. **Worker Processes Job** (`backend/src/routes/batch.js`, line ~30)
```javascript
batchQueue.process(async (job) => {
  const { jobId, data, config, fileName } = job.data;
  
  for (let i = 0; i < data.length; i++) {
    // Update progress every row
    job.progress(Math.floor((i / data.length) * 100));
    
    // Calculate Pocket ID
    const nearestPocket = findNearestPocket(lat, lon, config);
    
    // Collect mapping data
    mappings.push({ customerId, pocketId, ... });
  }
  
  // Save all mappings to database
  await mappingService.saveMappings(jobDatabaseId, enrichedMappings);
  
  // Generate Excel result
  const buffer = xlsx.write(workbook, { type: 'buffer' });
  
  // Update job status
  await query('UPDATE jobs SET status = completed ...');
});
```

**What happens:**
- Worker picks up job from Redis queue
- Processes each row sequentially
- Updates progress in Redis (0-100%)
- Calculates Pocket ID for each customer
- Finds nearest branch for each pocket
- Saves mappings to database
- Generates result Excel file
- Stores result in memory (Bull queue)

#### 4. **Frontend Polls for Updates** (`BatchProcessing.tsx`, line ~85)
```typescript
const startPolling = (jobId: string) => {
  setActiveJobId(jobId);
  
  // Poll every 2 seconds
  const interval = setInterval(() => {
    loadJobHistory(); // Fetches all jobs from backend
  }, 2000);
  
  setPollingInterval(interval);
};

// Auto-stop when job completes
useEffect(() => {
  const activeJob = jobs.find(j => j.jobId === activeJobId);
  if (activeJob?.status === 'completed') {
    stopPolling();
    setSuccess('Processing complete!');
  }
}, [jobs, activeJobId]);
```

**What happens:**
- Frontend calls `/api/v1/jobs?limit=20` every 2 seconds
- Backend queries Bull queue for job status
- Returns current progress (0-100%)
- Frontend updates progress bar
- Stops polling when status = 'completed' or 'failed'

---

## Best Practices Analysis

### ✅ What's Good

1. **Non-blocking Upload**
   - User gets immediate feedback (2-3 seconds)
   - Can continue working while processing happens
   - No browser timeout issues

2. **Background Processing**
   - Uses Bull queue + Redis for reliable job management
   - Worker can process jobs independently
   - Survives server restarts (jobs persist in Redis)

3. **Progress Tracking**
   - Real-time updates every 2 seconds
   - Visual progress bar
   - Clear status indicators

4. **Error Handling**
   - Failed jobs can be retried
   - Errors logged to database
   - User gets clear error messages

5. **Scalability**
   - Can process multiple jobs (queue handles concurrency)
   - Bulk database inserts (1000 at a time)
   - Efficient distance calculations (cached pocket centers)

### ⚠️ Areas for Improvement

1. **Synchronous Excel Parsing** (Current Bottleneck)
   - **Problem**: Parsing happens in API endpoint (blocks for 2-3 seconds)
   - **Impact**: Large files (17,000 rows) take longer to upload
   - **Better Approach**: Move parsing to worker

2. **Polling Overhead**
   - **Problem**: Frontend polls every 2 seconds (unnecessary API calls)
   - **Better Approach**: Use WebSockets or Server-Sent Events (SSE)

3. **Result Storage**
   - **Problem**: Excel results stored in memory (Bull queue)
   - **Impact**: Large results consume memory, lost on Redis restart
   - **Better Approach**: Store results in file system or S3

4. **No Batch Cancellation**
   - **Problem**: Can't cancel a running job
   - **Better Approach**: Add cancel button that stops worker

5. **Limited Error Recovery**
   - **Problem**: If one row fails, entire batch continues
   - **Better Approach**: Configurable error threshold (fail after X errors)

---

## Recommended Architecture (Best Practice)

### Improved Flow
```
User Upload → Frontend → Backend API → Queue Job → Worker → Parse → Process → Save → Store File
     ↓           ↓            ↓            ↓          ↓        ↓        ↓        ↓        ↓
  Select    Validate    Quick Check   Add to Bull  Get Job  Parse   Process  Database  S3/Disk
   File      Format     (< 1 sec)      Queue       from     Excel    Rows     Mappings  Results
                                                   Queue
                                      
Frontend ← WebSocket ← Worker (sends progress updates in real-time)
```

### Key Changes

#### 1. **Move Parsing to Worker** (Fastest Upload)
```javascript
// API Endpoint (< 1 second)
router.post('/encode', async (req, res) => {
  // Just validate it's a valid Excel file (read first row only)
  const workbook = xlsx.read(req.file.buffer, { type: 'buffer', sheetRows: 1 });
  
  // Store file buffer for worker
  await batchQueue.add({
    jobId,
    fileBuffer: req.file.buffer.toString('base64'),
    fileName
  });
  
  res.json({ jobId, fileName, total: 'Calculating...' });
});

// Worker (parses in background)
batchQueue.process(async (job) => {
  // Parse Excel here
  const buffer = Buffer.from(job.data.fileBuffer, 'base64');
  const data = xlsx.utils.sheet_to_json(sheet);
  
  // Update total in database
  await query('UPDATE jobs SET total = $1', [data.length]);
  
  // Process rows...
});
```

**Benefits:**
- Upload completes in < 1 second
- No blocking in API endpoint
- Better user experience

**Tradeoffs:**
- Can't validate row count before queueing
- Need to handle parsing errors in worker

#### 2. **Use WebSockets for Real-Time Updates** (No Polling)
```javascript
// Backend (Socket.IO)
io.on('connection', (socket) => {
  socket.on('subscribe-job', (jobId) => {
    // Send updates when job progress changes
    batchQueue.on('progress', (job, progress) => {
      if (job.id === jobId) {
        socket.emit('job-progress', { jobId, progress });
      }
    });
  });
});

// Frontend
const socket = io('http://localhost:3000');
socket.emit('subscribe-job', jobId);
socket.on('job-progress', ({ progress }) => {
  updateProgressBar(progress);
});
```

**Benefits:**
- Real-time updates (no 2-second delay)
- No unnecessary API calls
- Lower server load

**Tradeoffs:**
- More complex setup (Socket.IO)
- Need to handle reconnections
- Requires WebSocket support

#### 3. **Store Results in File System** (Persistent Storage)
```javascript
// Worker
const filePath = path.join(__dirname, '../../results', `${jobId}.xlsx`);
fs.writeFileSync(filePath, buffer);

await query('UPDATE jobs SET result_url = $1', [`/results/${jobId}.xlsx`]);

// Download Endpoint
router.get('/results/:jobId', (req, res) => {
  const filePath = path.join(__dirname, '../../results', `${req.params.jobId}.xlsx`);
  res.download(filePath);
});
```

**Benefits:**
- Results persist across restarts
- Lower memory usage
- Can serve large files efficiently

**Tradeoffs:**
- Need disk space management
- Need cleanup job for old files
- Slightly slower download

---

## Current vs Best Practice Comparison

| Aspect | Current Implementation | Best Practice | Impact |
|--------|----------------------|---------------|---------|
| **Upload Speed** | 2-3 seconds (parsing) | < 1 second (validation only) | ⭐⭐⭐ High |
| **Progress Updates** | Polling every 2 seconds | WebSocket real-time | ⭐⭐ Medium |
| **Result Storage** | In-memory (Redis) | File system / S3 | ⭐⭐ Medium |
| **Error Handling** | Basic retry | Configurable thresholds | ⭐ Low |
| **Cancellation** | Not supported | Cancel button | ⭐ Low |

---

## Recommendation

### For Your Use Case (17,000 rows)

**Keep Current Architecture** because:
1. ✅ Upload time (2-3 seconds) is acceptable
2. ✅ Polling works fine for your scale
3. ✅ In-memory storage is sufficient
4. ✅ Already implemented and working

**Optional Improvements** (if needed):
1. **Move parsing to worker** - Only if upload time becomes an issue (> 5 seconds)
2. **Add WebSockets** - Only if you need real-time updates (< 1 second latency)
3. **File storage** - Only if results are very large (> 10 MB) or need persistence

### When to Upgrade

Upgrade to best practice architecture when:
- Upload time > 5 seconds (move parsing to worker)
- Processing > 100,000 rows (optimize worker)
- Multiple concurrent users (add WebSockets)
- Results > 10 MB (use file storage)
- Need audit trail (add file storage)

---

## Code Review Checklist

### Current Implementation Review

**Frontend (`BatchProcessing.tsx`):**
- ✅ Clean component structure
- ✅ Good error handling
- ✅ Loading states
- ✅ Progress tracking
- ⚠️ Polling could be optimized (but acceptable)

**Backend (`batch.js`):**
- ✅ Proper async/await usage
- ✅ Error logging
- ✅ Database transactions
- ⚠️ Synchronous parsing (but acceptable for your scale)
- ⚠️ No request timeout handling

**Worker Process:**
- ✅ Progress updates
- ✅ Bulk database operations
- ✅ Error handling
- ✅ Statistics generation
- ⚠️ No cancellation support

**Overall Grade: B+ (Very Good)**
- Works reliably for your use case
- Good user experience
- Room for optimization if needed

---

## Summary

**Current Method:**
- Synchronous parsing in API (2-3 seconds)
- Background processing with Bull queue
- Polling for progress updates
- In-memory result storage

**Best Method (for your scale):**
- Keep current architecture
- It's well-designed and appropriate
- Only optimize if you hit performance issues

**Best Method (for large scale):**
- Async parsing in worker (< 1 second upload)
- WebSocket for real-time updates
- File system for result storage
- Cancellation support

**Your current implementation is solid and follows good practices for your scale. No urgent changes needed.**
