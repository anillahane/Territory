#!/usr/bin/env pwsh
# Start All Services Script

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  STARTING ALL SERVICES" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Start Docker Containers
Write-Host "1. Starting Docker Containers (PostgreSQL + Redis)..." -ForegroundColor Yellow
docker-compose up -d
Start-Sleep -Seconds 5
Write-Host "   ✓ Docker containers started" -ForegroundColor Green
Write-Host ""

# Wait for PostgreSQL to be ready
Write-Host "2. Waiting for PostgreSQL to be ready..." -ForegroundColor Yellow
$maxAttempts = 30
$attempt = 0
$ready = $false

while (-not $ready -and $attempt -lt $maxAttempts) {
    $attempt++
    try {
        docker exec location-pockets-db pg_isready -U postgres | Out-Null
        if ($LASTEXITCODE -eq 0) {
            $ready = $true
            Write-Host "   ✓ PostgreSQL is ready" -ForegroundColor Green
        } else {
            Write-Host "   - Attempt $attempt/$maxAttempts..." -ForegroundColor Gray
            Start-Sleep -Seconds 2
        }
    } catch {
        Write-Host "   - Attempt $attempt/$maxAttempts..." -ForegroundColor Gray
        Start-Sleep -Seconds 2
    }
}

if (-not $ready) {
    Write-Host "   ✗ PostgreSQL failed to start" -ForegroundColor Red
    exit 1
}
Write-Host ""

# Start Backend
Write-Host "3. Starting Backend (Node.js on port 3000)..." -ForegroundColor Yellow
Start-Process pwsh -ArgumentList "-NoExit", "-Command", "cd backend; npm start" -WindowStyle Normal
Start-Sleep -Seconds 5
Write-Host "   ✓ Backend started" -ForegroundColor Green
Write-Host ""

# Start Python Worker
Write-Host "4. Starting Python Worker..." -ForegroundColor Yellow
Start-Process pwsh -ArgumentList "-NoExit", "-Command", "cd backend-worker; python worker.py" -WindowStyle Normal
Start-Sleep -Seconds 3
Write-Host "   ✓ Python worker started" -ForegroundColor Green
Write-Host ""

# Start Frontend
Write-Host "5. Starting Frontend (Vite on port 5173)..." -ForegroundColor Yellow
Start-Process pwsh -ArgumentList "-NoExit", "-Command", "cd frontend; npm run dev" -WindowStyle Normal
Start-Sleep -Seconds 3
Write-Host "   ✓ Frontend started" -ForegroundColor Green
Write-Host ""

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  ALL SERVICES STARTED" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Services:" -ForegroundColor White
Write-Host "  - PostgreSQL: localhost:5434" -ForegroundColor Gray
Write-Host "  - Redis: localhost:6379" -ForegroundColor Gray
Write-Host "  - Backend API: http://localhost:3000" -ForegroundColor Gray
Write-Host "  - Frontend: http://localhost:5173" -ForegroundColor Gray
Write-Host "  - Python Worker: Running in background" -ForegroundColor Gray
Write-Host ""
Write-Host "Press Ctrl+C to stop monitoring. Services will continue running." -ForegroundColor Yellow
Write-Host ""

# Keep script running to show status
while ($true) {
    Start-Sleep -Seconds 30
}
