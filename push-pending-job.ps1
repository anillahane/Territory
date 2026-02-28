# Push pending job to Redis for Python worker processing
# This script finds the pending job and pushes it to the Redis queue

Write-Host "Checking for pending jobs..." -ForegroundColor Cyan

# Connect to PostgreSQL and get pending job details
$query = "SELECT job_id, data FROM jobs WHERE status = 'pending' AND type = 'batch_encode' ORDER BY created_at DESC LIMIT 1;"

# Run query using psql
$env:PGPASSWORD = "postgres"
$result = psql -h localhost -p 5434 -U postgres -d location_pockets -t -A -F "|" -c $query

if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to query database" -ForegroundColor Red
    Write-Host $result
    exit 1
}

if ([string]::IsNullOrWhiteSpace($result)) {
    Write-Host "No pending jobs found" -ForegroundColor Green
    exit 0
}

# Parse result
$parts = $result.Split('|')
$jobId = $parts[0].Trim()
$jobData = $parts[1].Trim()

Write-Host "Found pending job: $jobId" -ForegroundColor Yellow

# Parse job data to get file info
$dataObj = $jobData | ConvertFrom-Json
$fileName = $dataObj.fileName

# Find the uploaded file
$uploadDir = "backend/uploads"
$files = Get-ChildItem -Path $uploadDir -Filter "*$fileName" | Sort-Object LastWriteTime -Descending

if ($files.Count -eq 0) {
    Write-Host "Uploaded file not found in $uploadDir" -ForegroundColor Red
    exit 1
}

$filePath = $files[0].FullName
$relativeFilePath = $filePath -replace [regex]::Escape((Get-Location).Path + "\"), ""
$relativeFilePath = $relativeFilePath -replace "\\", "/"

Write-Host "File found: $relativeFilePath" -ForegroundColor Green

# Get config from database
$configQuery = "SELECT origin_lat, origin_lon, alphabet FROM config WHERE id = 1;"
$configResult = psql -h localhost -p 5434 -U postgres -d location_pockets -t -A -F "|" -c $configQuery

if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to get config" -ForegroundColor Red
    exit 1
}

$configParts = $configResult.Split('|')
$originLat = [double]$configParts[0].Trim()
$originLon = [double]$configParts[1].Trim()
$alphabet = $configParts[2].Trim()

# Create job payload
$jobPayload = @{
    jobId = $jobId
    filePath = $relativeFilePath
    fileName = $fileName
    config = @{
        originLat = $originLat
        originLon = $originLon
        alphabet = $alphabet
    }
} | ConvertTo-Json -Compress

Write-Host "Pushing job to Redis queue..." -ForegroundColor Cyan

# Push to Redis using redis-cli
$escapedPayload = $jobPayload -replace '"', '\"'
redis-cli -h localhost -p 6379 LPUSH python_batch_jobs "$jobPayload"

if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to push to Redis" -ForegroundColor Red
    exit 1
}

Write-Host "Job pushed to Redis successfully!" -ForegroundColor Green
Write-Host "Python worker should pick it up shortly..." -ForegroundColor Cyan
Write-Host ""
Write-Host "Monitor progress with: Get-Content backend/logs/app.log -Tail 20 -Wait" -ForegroundColor Gray
