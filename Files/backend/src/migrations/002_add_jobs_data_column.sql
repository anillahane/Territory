-- Add data column to jobs table for storing job metadata
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS data JSONB;

-- Create index on data column for faster queries
CREATE INDEX IF NOT EXISTS idx_jobs_data ON jobs USING GIN (data);
