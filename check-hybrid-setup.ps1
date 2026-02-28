# Check Hybrid Batch Processing Setup
# Verifies all components are properly configured

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Hybrid Batch Processing Setup Check" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$allGood = $true

# Check 1: Python Installation
Write-Host "1. Checking Python..." -ForegroundColor Yellow
$pythonVersion = python --version 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "   ✅ $pythonVersion" -ForegroundColor Green
} else {
    Write-Host "   ❌ Python not found" -ForegroundColor Red
    Write-Host "      Install from: https://www.python.org/" -ForegroundColor Gray
    $allGood = $false
}
Write-Host ""

# Check 2: Node.js Installation
Write-Host "2. Checking Node.js..." -ForegroundColor Yellow
$nodeVersion = node --version 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "   ✅ Node.js $nodeVersion" -ForegroundColor Green
} else {
    Write-Host "   ❌ Node.js not found" -ForegroundColor Red
    Write-Host "      Install from: https://nodejs.org/" -ForegroundColor Gray
    $allGood = $false
}
Write-Host ""

# Check 3: Docker Installation
Write-Host "3. Checking Docker..." -ForegroundColor Yellow
$dockerVersion = docker --version 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "   ✅ $dockerVersion" -ForegroundColor Green
} else {
    Write-Host "   ❌ Docker not found" -ForegroundColor Red
    Write-Host "      Install Docker Desktop from: https://www.docker.com/" -ForegroundColor Gray
    $allGood = $false
}
Write-Host ""

# Check 4: Redis Running
Write-Host "4. Checking Redis..." -ForegroundColor Yellow
$redisCheck = docker ps 2>&1 | Select-String "redis"
if ($redisCheck) {
    Write-Host "   ✅ Redis container running" -ForegroundColor Green
} else {
    Write-Host "   ⚠️  Redis not running" -ForegroundColor Yellow
    Write-Host "      Start with: docker-compose up -d redis" -ForegroundColor Gray
}
Write-Host ""

# Check 5: PostgreSQL Running
Write-Host "5. Checking PostgreSQL..." -ForegroundColor Yellow
$postgresCheck = docker ps 2>&1 | Select-String "postgres"
if ($postgresCheck) {
    Write-Host "   ✅ PostgreSQL container running" -ForegroundColor Green
} else {
    Write-Host "   ⚠️  PostgreSQL not running" -ForegroundColor Yellow
    Write-Host "      Start with: docker-compose up -d postgres" -ForegroundColor Gray
}
Write-Host ""

# Check 6: Backend Dependencies
Write-Host "6. Checking Backend Dependencies..." -ForegroundColor Yellow
if (Test-Path "backend\node_modules") {
    Write-Host "   ✅ Node modules installed" -ForegroundColor Green
} else {
    Write-Host "   ⚠️  Node modules not installed" -ForegroundColor Yellow
    Write-Host "      Run: cd backend; npm install" -ForegroundColor Gray
}
Write-Host ""

# Check 7: Python Dependencies
Write-Host "7. Checking Python Dependencies..." -ForegroundColor Yellow
if (Test-Path "backend-worker\venv") {
    Write-Host "   ✅ Python virtual environment exists" -ForegroundColor Green
    
    # Check if packages are installed
    & "backend-worker\venv\Scripts\Activate.ps1"
    $redisInstalled = pip list 2>&1 | Select-String "redis"
    $pandasInstalled = pip list 2>&1 | Select-String "pandas"
    
    if ($redisInstalled -and $pandasInstalled) {
        Write-Host "   ✅ Python packages installed" -ForegroundColor Green
    } else {
        Write-Host "   ⚠️  Python packages not installed" -ForegroundColor Yellow
        Write-Host "      Run: cd backend-worker; pip install -r requirements.txt" -ForegroundColor Gray
    }
} else {
    Write-Host "   ⚠️  Python virtual environment not found" -ForegroundColor Yellow
    Write-Host "      Run: python -m venv backend-worker\venv" -ForegroundColor Gray
}
Write-Host ""

# Check 8: Configuration Files
Write-Host "8. Checking Configuration..." -ForegroundColor Yellow
if (Test-Path "backend\.env") {
    $envContent = Get-Content "backend\.env" -Raw
    
    # Check for new config options
    $hasThreshold = $envContent -match "PYTHON_WORKER_THRESHOLD"
    $hasRedisUrl = $envContent -match "REDIS_URL"
    $hasMaxSize = $envContent -match "MAX_FILE_SIZE_MB"
    
    if ($hasThreshold -and $hasRedisUrl -and $hasMaxSize) {
        Write-Host "   ✅ Backend .env configured" -ForegroundColor Green
    } else {
        Write-Host "   ⚠️  Backend .env missing new options" -ForegroundColor Yellow
        if (-not $hasThreshold) {
            Write-Host "      Add: PYTHON_WORKER_THRESHOLD=5000" -ForegroundColor Gray
        }
        if (-not $hasRedisUrl) {
            Write-Host "      Add: REDIS_URL=redis://localhost:6379" -ForegroundColor Gray
        }
        if (-not $hasMaxSize) {
            Write-Host "      Add: MAX_FILE_SIZE_MB=50" -ForegroundColor Gray
        }
    }
} else {
    Write-Host "   ❌ Backend .env not found" -ForegroundColor Red
    Write-Host "      Copy from: backend\.env.example" -ForegroundColor Gray
    $allGood = $false
}
Write-Host ""

# Check 9: Uploads Directory
Write-Host "9. Checking Uploads Directory..." -ForegroundColor Yellow
if (Test-Path "backend\uploads") {
    Write-Host "   ✅ Uploads directory exists" -ForegroundColor Green
} else {
    Write-Host "   ⚠️  Uploads directory not found" -ForegroundColor Yellow
    Write-Host "      Creating directory..." -ForegroundColor Gray
    New-Item -ItemType Directory -Path "backend\uploads" | Out-Null
    Write-Host "   ✅ Created uploads directory" -ForegroundColor Green
}
Write-Host ""

# Check 10: Worker Files
Write-Host "10. Checking Worker Files..." -ForegroundColor Yellow
$workerExists = Test-Path "backend-worker\worker.py"
$requirementsExists = Test-Path "backend-worker\requirements.txt"
$dockerfileExists = Test-Path "backend-worker\Dockerfile"

if ($workerExists -and $requirementsExists -and $dockerfileExists) {
    Write-Host "   ✅ All worker files present" -ForegroundColor Green
} else {
    Write-Host "   ❌ Worker files missing" -ForegroundColor Red
    if (-not $workerExists) { Write-Host "      Missing: worker.py" -ForegroundColor Gray }
    if (-not $requirementsExists) { Write-Host "      Missing: requirements.txt" -ForegroundColor Gray }
    if (-not $dockerfileExists) { Write-Host "      Missing: Dockerfile" -ForegroundColor Gray }
    $allGood = $false
}
Write-Host ""

# Summary
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Summary" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

if ($allGood) {
    Write-Host "✅ All critical components are ready!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Yellow
    Write-Host "  1. Start backend:       cd backend; npm run dev" -ForegroundColor Gray
    Write-Host "  2. Start Python worker: .\start-python-worker.ps1" -ForegroundColor Gray
    Write-Host "  3. Start frontend:      cd frontend; npm run dev" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Or use Docker:" -ForegroundColor Yellow
    Write-Host "  docker-compose up -d" -ForegroundColor Gray
} else {
    Write-Host "⚠️  Some components need attention" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Please fix the issues marked with ❌ above" -ForegroundColor Gray
}
Write-Host ""

# Performance Info
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Performance Info" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Hybrid Processing:" -ForegroundColor Yellow
Write-Host "  • Small files (< 5,000 rows)  → Node.js worker" -ForegroundColor Gray
Write-Host "  • Large files (≥ 5,000 rows)  → Python worker" -ForegroundColor Gray
Write-Host ""
Write-Host "Expected Performance:" -ForegroundColor Yellow
Write-Host "  • 1,000 rows:   ~15s (Node.js)" -ForegroundColor Gray
Write-Host "  • 5,000 rows:   ~35s (Python, 2.6x faster)" -ForegroundColor Gray
Write-Host "  • 10,000 rows:  ~60s (Python, 3x faster)" -ForegroundColor Gray
Write-Host "  • 25,000 rows:  ~120s (Python, 3.75x faster)" -ForegroundColor Gray
Write-Host "  • 50,000 rows:  ~240s (Python, 3.75x faster)" -ForegroundColor Gray
Write-Host ""
Write-Host "Memory Usage:" -ForegroundColor Yellow
Write-Host "  • Python worker: Flat ~300MB (any file size)" -ForegroundColor Gray
Write-Host "  • Node.js worker: Scales with file size" -ForegroundColor Gray
Write-Host ""

Write-Host "For more information, see:" -ForegroundColor Yellow
Write-Host "  • QUICK_START_HYBRID.md" -ForegroundColor Gray
Write-Host "  • HYBRID_BATCH_PROCESSING.md" -ForegroundColor Gray
Write-Host "  • backend-worker/README.md" -ForegroundColor Gray
Write-Host ""
