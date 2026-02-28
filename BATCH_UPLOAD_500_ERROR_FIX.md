# Batch Upload 500 Error Fix

## Issue
When uploading files for batch processing, users received "Request failed with status code 500" error.

## Root Cause
The `jobs` table in the database was missing the `data` column (JSONB type) that the backend code was trying to write to when storing job metadata.

## Solution
Added the `data` column to the `jobs` table:

```sql
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS data JSONB;
CREATE INDEX IF NOT EXISTS idx_jobs_data ON jobs USING GIN (data);
```

## Files Changed
1. **backend/src/migrations/002_add_jobs_data_column.sql** (new file)
   - Migration script to add the data column
   - Creates GIN index for efficient JSONB queries

## Migration Applied
The migration was applied directly to the database:
```bash
docker exec location-pockets-db psql -U postgres -d location_pockets -c "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS data JSONB;"
docker exec location-pockets-db psql -U postgres -d location_pockets -c "CREATE INDEX IF NOT EXISTS idx_jobs_data ON jobs USING GIN (data);"
```

## Verification
Confirmed the column exists:
```sql
\d jobs
```

Output shows:
- `data` column of type `jsonb`
- `idx_jobs_data` GIN index on the data column

## What the Data Column Stores
The `data` column stores job metadata as JSON:
```json
{
  "fileName": "customers.xlsx",
  "pocketStats": {
    "AA-01": 250,
    "AA-02": 245
  },
  "totalPockets": 245,
  "totalAccounts": 18000
}
```

## Testing
After applying this fix:
1. Go to Batch Processing page
2. Upload a file
3. Verify: No 500 error
4. Verify: Success message appears
5. Verify: Job appears in history
6. Verify: Job processes successfully
7. Verify: Statistics are available after completion

## Status
✅ Fixed - Database schema updated, batch upload should now work correctly.
