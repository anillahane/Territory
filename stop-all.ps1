#!/usr/bin/env pwsh
# Stop All Services Script

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  STOPPING ALL SERVICES" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Stop Python Worker
Write-Host "1. Stopping Python Worker..." -ForegroundColor Yellow
$pythonProcesses = Get-Process python -ErrorAction SilentlyContinue
if ($pythonProcesses) {
    $pythonProcesses | Where-Object { $_.Path -like "*backend-worker*" -or $_.CommandLine -like "*worker.py*" } | Stop-Process -Force
    Write-Host "   ✓ Python worker stopped" -ForegroundColor Green
} else {
    Write-Host "   - No Python worker running" -ForegroundColor Gray
}

# Stop Backend (Node.js)
Write-Host "2. Stopping Backend (Node.js)..." -ForegroundColor Yellow
$nodeProcesses = Get-Process node -ErrorAction SilentlyContinue
if ($nodeProcesses) {
    $nodeProcesses | Where-Object { $_.Path -like "*backend*" } | Stop-Process -Force
    Write-Host "   ✓ Backend stopped" -ForegroundColor Green
} else {
    Write-Host "   - No backend running" -ForegroundColor Gray
}

# Stop Frontend (Vite)
Write-Host "3. Stopping Frontend (Vite)..." -ForegroundColor Yellow
$viteProcesses = Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*vite*" }
if ($viteProcesses) {
    $viteProcesses | Stop-Process -Force
    Write-Host "   ✓ Frontend stopped" -ForegroundColor Green
} else {
    Write-Host "   - No frontend running" -ForegroundColor Gray
}

# Stop Docker Containers
Write-Host "4. Stopping Docker Containers..." -ForegroundColor Yellow
docker-compose down
Write-Host "   ✓ Docker containers stopped" -ForegroundColor Green

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  ALL SERVICES STOPPED" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
