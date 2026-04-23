# Testing the Hybrid Batch Processing System

## Pre-Test Checklist

Before testing, ensure all components are running:

```powershell
# Run setup check
.\check-hybrid-setup.ps1
```

Expected output:
- ✅ Python installed
- ✅ Node.js installed
- ✅ Docker installed
- ✅ Redis running
- ✅ PostgreSQL running
- ✅ Backend dependencies installed
- ✅ Python dependencies installed
- ✅ Configuration files present

## Test 1: Small File (Node.js Worker)

### Objective
Verify that small files are processed by the Node.js worker.

### Test Data
Create `test-small.xlsx` with 1,000 rows:

| lan      | canon_lat | canon_long |
|----------|-----------|------------|
| CUST001  | 12.9716   | 77.5946    |
| CUST002  | 13.0827   | 80.2707    |
| ...      | ...       | ...        |
| CUST1000 | 11.0168   | 76.9558    |

### Steps

1. **Upload file:**
   - Go to http://localhost:5173
   - Navigate to "Batch Processing"
   - Click "Upload File"
   - Select `test-small.xlsx`
   - Click "Upload & Process"

2. **Verify routing:**
   - Check backend logs:
   ```
   Routing to Node.js worker (small file)
   Batch job queued
   Processing batch job (Node.js worker)
   ```

3. **Monitor progress:**
   - Watch progress bar in UI
   - Should show 0% → 100%
   - Expected time: 15-30 seconds

4. **Verify completion:**
   - Status should change to "Completed"
   - "Download Results" button should appear
   - Backend logs should show:
   ```
   Batch job completed (Node.js worker)
   ```

5. **Download results:**
   - Click "Download Results"
   - File should download: `pocket_ids_*.xlsx`
   - Open file and verify:
     - Sheet 1: Results with PocketID column
     - Sheet 2: Statistics with pocket counts

### Expected Results

✅ File processed in 15-30 seconds  
✅ Used Node.js worker  
✅ Results downloaded successfully  
✅ All rows have valid Pocket IDs  
✅ Statistics sheet shows pocket distribution  

### Verification Queries

```sql
-- Check job was created
SELECT * FROM jobs 
WHERE type = 'batch_encode' 
ORDER BY created_at DESC 
LIMIT 1;

-- Verify worker used
SELECT data->>'worker' as worker FROM jobs 
WHERE type = 'batch_encode' 
ORDER BY created_at DESC 
LIMIT 1;
-- Expected: "nodejs"

-- Check mappings were saved
SELECT COUNT(*) FROM customer_pocket_mappings 
WHERE job_id = (SELECT id FROM jobs ORDER BY created_at DESC LIMIT 1);
-- Expected: 1000
```

## Test 2: Large File (Python Worker)

### Objective
Verify that large files are processed by the Python worker.

### Test Data
Create `test-large.xlsx` with 10,000 rows:

| lan       | canon_lat | canon_long |
|-----------|-----------|------------|
| CUST0001  | 12.9716   | 77.5946    |
| CUST0002  | 13.0827   | 80.2707    |
| ...       | ...       | ...        |
| CUST10000 | 11.0168   | 76.9558    |

### Steps

1. **Upload file:**
   - Go to http://localhost:5173
   - Navigate to "Batch Processing"
   - Click "Upload File"
   - Select `test-large.xlsx`
   - Click "Upload & Process"

2. **Verify routing:**
   - Check backend logs:
   ```
   Routing to Python worker (large file)
   Batch job queued for Python worker
   ```
   
   - Check Python worker logs:
   ```
   📥 Received job: uuid-here
   🔄 Starting job uuid-here
   📊 Counting rows...
   📝 Processing 10000 rows...
   ```

3. **Monitor progress:**
   - Watch progress bar in UI
   - Should show 0% → 100%
   - Expected time: 60-90 seconds
   - Python worker logs should show:
   ```
   Processing chunk 1 (5000 rows)...
   Processing chunk 2 (5000 rows)...
   💾 Saving mappings to database...
   ✅ Job uuid-here completed successfully
   ```

4. **Verify completion:**
   - Status should change to "Completed"
   - "Download Results" button should appear
   - Python worker logs should show:
   ```
   Processed: 10000 rows
   Unique pockets: XX
   Mappings saved: 10000
   ```

5. **Download results:**
   - Click "Download Results"
   - File should download: `pocket_ids_*.xlsx`
   - Open file and verify:
     - Sheet 1: Results with PocketID column
     - Sheet 2: Statistics with pocket counts

### Expected Results

✅ File processed in 60-90 seconds  
✅ Used Python worker  
✅ Results downloaded successfully  
✅ All rows have valid Pocket IDs  
✅ Statistics sheet shows pocket distribution  
✅ 3x faster than Node.js would be  

### Verification Queries

```sql
-- Check job was created
SELECT * FROM jobs 
WHERE type = 'batch_encode' 
ORDER BY created_at DESC 
LIMIT 1;

-- Verify worker used
SELECT data->>'worker' as worker FROM jobs 
WHERE type = 'batch_encode' 
ORDER BY created_at DESC 
LIMIT 1;
-- Expected: "python"

-- Check mappings were saved
SELECT COUNT(*) FROM customer_pocket_mappings 
WHERE job_id = (SELECT id FROM jobs ORDER BY created_at DESC LIMIT 1);
-- Expected: 10000

-- Check processing time
SELECT 
  job_id,
  total,
  data->>'worker' as worker,
  EXTRACT(EPOCH FROM (completed_at - created_at)) as duration_seconds
FROM jobs 
WHERE type = 'batch_encode' 
ORDER BY created_at DESC 
LIMIT 1;
-- Expected: 60-90 seconds
```

## Test 3: Threshold Boundary

### Objective
Verify that the threshold works correctly at exactly 5,000 rows.

### Test Data
Create two files:
- `test-4999.xlsx` with 4,999 rows (should use Node.js)
- `test-5000.xlsx` with 5,000 rows (should use Python)

### Steps

1. **Upload 4,999-row file:**
   - Upload `test-4999.xlsx`
   - Check logs: Should say "Node.js worker"

2. **Upload 5,000-row file:**
   - Upload `test-5000.xlsx`
   - Check logs: Should say "Python worker"

### Expected Results

✅ 4,999 rows → Node.js worker  
✅ 5,000 rows → Python worker  
✅ Threshold working correctly  

## Test 4: Error Handling

### Objective
Verify that errors are handled gracefully.

### Test Cases

#### 4.1: Empty File

1. Create `test-empty.xlsx` with headers only (no data rows)
2. Upload file
3. Expected: Error message "Excel file is empty"

#### 4.2: Invalid Coordinates

1. Create `test-invalid.xlsx` with invalid coordinates:
   ```
   | lan     | canon_lat | canon_long |
   |---------|-----------|------------|
   | CUST001 | invalid   | 77.5946    |
   | CUST002 | 13.0827   | invalid    |
   ```
2. Upload file
3. Expected: Rows marked as "ERROR" in results

#### 4.3: Missing Columns

1. Create `test-missing.xlsx` without required columns
2. Upload file
3. Expected: Error or rows marked as "ERROR"

#### 4.4: No Branches

1. Delete all branches from database:
   ```sql
   DELETE FROM branches;
   ```
2. Upload file
3. Expected: Job fails with "No branches found"
4. Restore branches:
   ```sql
   -- Re-upload branches via UI
   ```

### Expected Results

✅ Empty file rejected  
✅ Invalid coordinates handled gracefully  
✅ Missing columns handled  
✅ No branches error clear  

## Test 5: Performance Comparison

### Objective
Measure actual performance improvement.

### Test Data
Create files of various sizes:
- `test-1k.xlsx` - 1,000 rows
- `test-5k.xlsx` - 5,000 rows
- `test-10k.xlsx` - 10,000 rows
- `test-25k.xlsx` - 25,000 rows

### Steps

1. **Test each file:**
   - Upload file
   - Record start time
   - Wait for completion
   - Record end time
   - Note which worker was used

2. **Record results:**

| File   | Rows   | Worker  | Time (seconds) |
|--------|--------|---------|----------------|
| 1k     | 1,000  | Node.js | ___            |
| 5k     | 5,000  | Python  | ___            |
| 10k    | 10,000 | Python  | ___            |
| 25k    | 25,000 | Python  | ___            |

3. **Compare with expected:**

| File   | Expected | Actual | Match? |
|--------|----------|--------|--------|
| 1k     | 15s      | ___    | ___    |
| 5k     | 35s      | ___    | ___    |
| 10k    | 60s      | ___    | ___    |
| 25k    | 120s     | ___    | ___    |

### Expected Results

✅ Times within 20% of expected  
✅ Python 2-4x faster than Node.js would be  
✅ Consistent performance across runs  

## Test 6: Concurrent Processing

### Objective
Verify that multiple files can be processed simultaneously.

### Steps

1. **Upload 3 files simultaneously:**
   - `test-1.xlsx` (1,000 rows)
   - `test-2.xlsx` (1,000 rows)
   - `test-3.xlsx` (1,000 rows)

2. **Monitor job history:**
   - All 3 should appear in job list
   - All should process (may be sequential)
   - All should complete successfully

3. **Upload 2 large files:**
   - `test-large-1.xlsx` (10,000 rows)
   - `test-large-2.xlsx` (10,000 rows)

4. **Monitor Python worker:**
   - Should process one at a time
   - Both should complete successfully

### Expected Results

✅ Multiple small files processed  
✅ Multiple large files processed  
✅ No conflicts or errors  
✅ All results downloadable  

## Test 7: Memory Usage

### Objective
Verify that memory usage is efficient.

### Steps

1. **Monitor Node.js memory (small file):**
   ```powershell
   # Windows Task Manager
   # Watch "Node.js" process during upload
   ```
   - Upload 2,000-row file
   - Record peak memory usage
   - Expected: < 200 MB

2. **Monitor Python memory (large file):**
   ```powershell
   # Windows Task Manager
   # Watch "Python" process during upload
   ```
   - Upload 20,000-row file
   - Record peak memory usage
   - Expected: < 400 MB (flat)

### Expected Results

✅ Node.js memory reasonable for small files  
✅ Python memory flat for large files  
✅ No memory spikes or crashes  

## Test 8: Download Verification

### Objective
Verify that downloaded files are correct.

### Steps

1. **Upload test file**
2. **Download results**
3. **Open Excel file and verify:**

   **Sheet 1: Results**
   - All original columns present
   - PocketID column added
   - Distance columns added
   - Pocket center coordinates added
   - No ERROR values (unless invalid input)

   **Sheet 2: Statistics**
   - Pocket ID column
   - Account Count column
   - Sorted by count (descending)
   - Sum of counts = total rows

4. **Verify database:**
   ```sql
   -- Check mappings match Excel
   SELECT 
     customer_id,
     pocket_id,
     distance_customer_to_pocket,
     nearest_branch_id
   FROM customer_pocket_mappings
   WHERE job_id = (SELECT id FROM jobs ORDER BY created_at DESC LIMIT 1)
   LIMIT 10;
   ```

### Expected Results

✅ Excel file has 2 sheets  
✅ All data present and correct  
✅ Statistics accurate  
✅ Database matches Excel  

## Test 9: Configuration Changes

### Objective
Verify that threshold configuration works.

### Steps

1. **Change threshold to 2000:**
   ```bash
   # backend/.env
   PYTHON_WORKER_THRESHOLD=2000
   ```

2. **Restart backend:**
   ```powershell
   # Ctrl+C in backend terminal
   npm run dev
   ```

3. **Upload 3,000-row file:**
   - Should use Python worker (3000 ≥ 2000)

4. **Change threshold to 10000:**
   ```bash
   # backend/.env
   PYTHON_WORKER_THRESHOLD=10000
   ```

5. **Restart backend**

6. **Upload 5,000-row file:**
   - Should use Node.js worker (5000 < 10000)

### Expected Results

✅ Threshold changes take effect  
✅ Routing follows new threshold  
✅ Both workers still functional  

## Test 10: Failure Recovery

### Objective
Verify that system recovers from failures.

### Steps

1. **Stop Python worker:**
   - Ctrl+C in Python worker terminal

2. **Upload large file:**
   - Should queue successfully
   - Job status: "pending"

3. **Restart Python worker:**
   ```powershell
   .\start-python-worker.ps1
   ```

4. **Verify processing:**
   - Job should be picked up
   - Should process successfully

### Expected Results

✅ Job queues even if worker down  
✅ Job processes when worker starts  
✅ No data loss  
✅ Graceful recovery  

## Troubleshooting Tests

If any test fails, check:

1. **Backend logs:**
   ```powershell
   docker-compose logs -f backend
   ```

2. **Python worker logs:**
   ```powershell
   docker-compose logs -f python-worker
   ```

3. **Redis queue:**
   ```bash
   redis-cli
   > LLEN python_batch_jobs
   > KEYS bull:batch-process:*
   ```

4. **Database:**
   ```sql
   SELECT * FROM jobs ORDER BY created_at DESC LIMIT 5;
   ```

5. **File system:**
   ```powershell
   dir backend\uploads
   ```

## Success Criteria

All tests should pass with:

✅ Correct worker routing  
✅ Fast processing times  
✅ Low memory usage  
✅ Accurate results  
✅ Proper error handling  
✅ Graceful recovery  
✅ Configuration flexibility  

## Performance Benchmarks

Record your results:

| Test | Expected | Actual | Pass? |
|------|----------|--------|-------|
| Small file (1k) | 15s | ___ | ___ |
| Medium file (5k) | 35s | ___ | ___ |
| Large file (10k) | 60s | ___ | ___ |
| XL file (25k) | 120s | ___ | ___ |
| Memory (Node.js) | <200MB | ___ | ___ |
| Memory (Python) | <400MB | ___ | ___ |

## Conclusion

After completing all tests, you should have:

✅ Verified hybrid routing works correctly  
✅ Confirmed performance improvements  
✅ Validated error handling  
✅ Tested configuration changes  
✅ Verified failure recovery  
✅ Measured actual performance  

The system is ready for production use! 🚀
