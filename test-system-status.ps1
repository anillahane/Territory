# Test System Status
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  System Status Check" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check PostgreSQL
Write-Host "1. PostgreSQL:" -ForegroundColor Yellow
$postgres = docker ps | Select-String "postgres"
if ($postgres) {
    Write-Host "   ✅ Running" -ForegroundColor Green
} else {
    Write-Host "   ❌ Not running" -ForegroundColor Red
}

# Check Redis
Write-Host "2. Redis:" -ForegroundColor Yellow
$redis = docker ps | Select-String "redis"
if ($redis) {
    Write-Host "   ✅ Running" -ForegroundColor Green
} else {
    Write-Host "   ❌ Not running" -ForegroundColor Red
}

# Check Backend (Node.js)
Write-Host "3. Backend (Node.js):" -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://localhost:3000/api/v1/health" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
    Write-Host "   ✅ Running on port 3000" -ForegroundColor Green
} catch {
    Write-Host "   ⚠️  Not responding (may need to start)" -ForegroundColor Yellow
    Write-Host "      Run: cd backend; npm run dev" -ForegroundColor Gray
}

# Check Frontend
Write-Host "4. Frontend (React):" -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://localhost:5173" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
    Write-Host "   ✅ Running on port 5173" -ForegroundColor Green
} catch {
    Write-Host "   ⚠️  Not responding (may need to start)" -ForegroundColor Yellow
    Write-Host "      Run: cd frontend; npm run dev" -ForegroundColor Gray
}

# Check Python Worker
Write-Host "5. Python Worker:" -ForegroundColor Yellow
$pythonProcess = Get-Process -Name python -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*worker.py*" }
if ($pythonProcess) {
    Write-Host "   ✅ Running" -ForegroundColor Green
} else {
    Write-Host "   ⚠️  Not detected" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Ready to Test!" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "If backend/frontend are not running:" -ForegroundColor Yellow
Write-Host "  Terminal 1: cd backend; npm run dev" -ForegroundColor Gray
Write-Host "  Terminal 2: cd frontend; npm run dev" -ForegroundColor Gray
Write-Host ""
Write-Host "Then open: http://localhost:5173" -ForegroundColor Green
Write-Host "Go to: Batch Processing" -ForegroundColor Green
Write-Host ""
