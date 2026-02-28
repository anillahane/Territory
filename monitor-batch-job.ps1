# Monitor Batch Processing Job
param(
    [string]$jobId = ""
)

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Batch Processing Monitor" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

if ($jobId -eq "") {
    Write-Host "Getting latest job..." -ForegroundColor Yellow
    try {
        $response = Invoke-RestMethod -Uri "http://localhost:3000/api/v1/jobs?limit=1" -Method Get
        if ($response.jobs.Count -gt 0) {
            $jobId = $response.jobs[0].jobId
            Write-Host "Found job: $jobId" -ForegroundColor Green
        } else {
            Write-Host "No jobs found. Upload a file first." -ForegroundColor Red
            exit
        }
    } catch {
        Write-Host "Error getting jobs: $_" -ForegroundColor Red
        exit
    }
}

Write-Host "Monitoring job: $jobId" -ForegroundColor Cyan
Write-Host ""

$lastProgress = -1
$startTime = Get-Date

while ($true) {
    try {
        $job = Invoke-RestMethod -Uri "http://localhost:3000/api/v1/batch/status/$jobId" -Method Get
        
        $elapsed = (Get-Date) - $startTime
        $elapsedStr = "{0:mm}:{0:ss}" -f $elapsed
        
        # Clear previous line
        Write-Host "`r" -NoNewline
        
        # Show status
        $statusColor = switch ($job.status) {
            "pending" { "Yellow" }
            "active" { "Cyan" }
            "completed" { "Green" }
            "failed" { "Red" }
            default { "White" }
        }
        
        Write-Host "Status: " -NoNewline
        Write-Host $job.status.ToUpper() -ForegroundColor $statusColor -NoNewline
        Write-Host " | Progress: " -NoNewline
        Write-Host "$($job.progress)%" -ForegroundColor Cyan -NoNewline
        Write-Host " | Rows: " -NoNewline
        Write-Host $job.total -ForegroundColor White -NoNewline
        Write-Host " | Time: " -NoNewline
        Write-Host $elapsedStr -ForegroundColor Gray -NoNewline
        
        if ($job.status -eq "completed") {
            Write-Host ""
            Write-Host ""
            Write-Host "✅ Job completed successfully!" -ForegroundColor Green
            Write-Host ""
            Write-Host "Results:" -ForegroundColor Yellow
            Write-Host "  Download URL: $($job.resultUrl)" -ForegroundColor Gray
            Write-Host "  Total time: $elapsedStr" -ForegroundColor Gray
            Write-Host ""
            Write-Host "Download from: http://localhost:5173/batch" -ForegroundColor Cyan
            break
        }
        
        if ($job.status -eq "failed") {
            Write-Host ""
            Write-Host ""
            Write-Host "❌ Job failed!" -ForegroundColor Red
            Write-Host "Error: $($job.error)" -ForegroundColor Red
            break
        }
        
        Start-Sleep -Seconds 2
        
    } catch {
        Write-Host ""
        Write-Host "Error checking status: $_" -ForegroundColor Red
        break
    }
}

Write-Host ""
