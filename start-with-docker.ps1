# Location Pockets System - Start Script with Docker
# This script starts the full development environment

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Location Pockets System - Startup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Function to check if a command exists
function Test-Command {
    param($Command)
    try {
        if (Get-Command $Command -ErrorAction Stop) {
            return $true
        }
    }
    catch {
        return $false
    }
}

# Function to check if Docker is running
function Test-DockerRunning {
    try {
        docker ps | Out-Null
        return $true
    }
    catch {
        return $false
    }
}

# Step 1: Check Docker installation
Write-Host "Step 1: Checking Docker installation..." -ForegroundColor Yellow
if (-not (Test-Command "docker")) {
    Write-Host "[ERROR] Docker is not installed!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please install Docker Desktop from:" -ForegroundColor Yellow
    Write-Host "https://www.docker.com/products/docker-desktop/" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "After installation:" -ForegroundColor Yellow
    Write-Host "1. Restart your computer" -ForegroundColor White
    Write-Host "2. Start Docker Desktop" -ForegroundColor White
    Write-Host "3. Run this script again" -ForegroundColor White
    Write-Host ""
    Write-Host "For detailed instructions, see: DOCKER_SETUP_GUIDE.md" -ForegroundColor Cyan
    exit 1
}

Write-Host "[OK] Docker is installed" -ForegroundColor Green

# Step 2: Check if Docker is running
Write-Host ""
Write-Host "Step 2: Checking if Docker is running..." -ForegroundColor Yellow
if (-not (Test-DockerRunning)) {
    Write-Host "[ERROR] Docker is not running!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please start Docker Desktop:" -ForegroundColor Yellow
    Write-Host "1. Open Docker Desktop from Start Menu" -ForegroundColor White
    Write-Host "2. Wait for Docker to start (whale icon in system tray)" -ForegroundColor White
    Write-Host "3. Run this script again" -ForegroundColor White
    Write-Host ""
    Write-Host "Attempting to start Docker Desktop..." -ForegroundColor Yellow
    Start-Process "C:\Program Files\Docker\Docker\Docker Desktop.exe" -ErrorAction SilentlyContinue
    Write-Host "Please wait for Docker to start, then run this script again." -ForegroundColor Yellow
    exit 1
}

Write-Host "[OK] Docker is running" -ForegroundColor Green

# Step 3: Check Node.js installation
Write-Host ""
Write-Host "Step 3: Checking Node.js installation..." -ForegroundColor Yellow
if (-not (Test-Command "node")) {
    Write-Host "[ERROR] Node.js is not installed!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please install Node.js 20 LTS from:" -ForegroundColor Yellow
    Write-Host "https://nodejs.org/" -ForegroundColor Cyan
    exit 1
}

$nodeVersion = node --version
Write-Host "[OK] Node.js $nodeVersion is installed" -ForegroundColor Green

# Step 4: Start Docker services
Write-Host ""
Write-Host "Step 4: Starting Docker services (PostgreSQL + Redis)..." -ForegroundColor Yellow
Write-Host "This may take a minute on first run..." -ForegroundColor Gray

docker-compose up -d postgres redis

if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Failed to start Docker services!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Try these troubleshooting steps:" -ForegroundColor Yellow
    Write-Host "1. Check Docker Desktop is running" -ForegroundColor White
    Write-Host "2. Run: docker-compose down" -ForegroundColor White
    Write-Host "3. Run this script again" -ForegroundColor White
    Write-Host ""
    Write-Host "For more help, see: DOCKER_SETUP_GUIDE.md" -ForegroundColor Cyan
    exit 1
}

Write-Host "[OK] Docker services started" -ForegroundColor Green

# Step 5: Wait for services to be healthy
Write-Host ""
Write-Host "Step 5: Waiting for services to be ready..." -ForegroundColor Yellow
Write-Host "Checking health status..." -ForegroundColor Gray

$maxAttempts = 30
$attempt = 0
$servicesReady = $false

while ($attempt -lt $maxAttempts -and -not $servicesReady) {
    $attempt++
    Start-Sleep -Seconds 2
    
    try {
        $status = docker-compose ps --format json | ConvertFrom-Json
        $postgresHealthy = $false
        $redisHealthy = $false
        
        foreach ($service in $status) {
            if ($service.Service -eq "postgres" -and $service.Health -eq "healthy") {
                $postgresHealthy = $true
            }
            if ($service.Service -eq "redis" -and $service.Health -eq "healthy") {
                $redisHealthy = $true
            }
        }
        
        if ($postgresHealthy -and $redisHealthy) {
            $servicesReady = $true
        }
        else {
            Write-Host "." -NoNewline -ForegroundColor Gray
        }
    }
    catch {
        Write-Host "." -NoNewline -ForegroundColor Gray
    }
}

Write-Host ""

if (-not $servicesReady) {
    Write-Host "[WARNING] Services are taking longer than expected to start" -ForegroundColor Yellow
    Write-Host "Continuing anyway... Check logs if you encounter issues:" -ForegroundColor Yellow
    Write-Host "docker-compose logs postgres" -ForegroundColor Cyan
    Write-Host "docker-compose logs redis" -ForegroundColor Cyan
}
else {
    Write-Host "[OK] Services are healthy and ready" -ForegroundColor Green
}

# Step 6: Check if migrations are needed
Write-Host ""
Write-Host "Step 6: Checking database setup..." -ForegroundColor Yellow

if (-not (Test-Path "backend\.env")) {
    Write-Host "Creating backend/.env file..." -ForegroundColor Gray
    
    $envContent = @"
NODE_ENV=development
PORT=3000

# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=location_pockets
DB_USER=postgres
DB_PASSWORD=postgres

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# CORS
CORS_ORIGIN=http://localhost:5173
"@
    
    Set-Content -Path "backend\.env" -Value $envContent
    Write-Host "[OK] Created backend/.env" -ForegroundColor Green
}

# Check if migrations have been run
Write-Host "Checking if migrations are needed..." -ForegroundColor Gray

$migrationNeeded = $true
try {
    $result = docker exec location-pockets-db psql -U postgres -d location_pockets -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'config';" 2>$null
    if ($result -match "1") {
        $migrationNeeded = $false
        Write-Host "[OK] Database is already set up" -ForegroundColor Green
    }
}
catch {
    # Migration needed
}

if ($migrationNeeded) {
    Write-Host "Running database migrations..." -ForegroundColor Gray
    Push-Location backend
    npm run migrate
    Pop-Location
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[OK] Migrations completed successfully" -ForegroundColor Green
    }
    else {
        Write-Host "[WARNING] Migration may have failed. Check output above." -ForegroundColor Yellow
    }
}

# Step 7: Display status
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Environment Status" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

docker-compose ps

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Next Steps" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Your Docker services are running!" -ForegroundColor Green
Write-Host ""
Write-Host "To start the backend:" -ForegroundColor Yellow
Write-Host "  cd backend" -ForegroundColor Cyan
Write-Host "  npm run dev" -ForegroundColor Cyan
Write-Host ""
Write-Host "To start the frontend (in a new terminal):" -ForegroundColor Yellow
Write-Host "  cd frontend" -ForegroundColor Cyan
Write-Host "  npm install" -ForegroundColor Cyan
Write-Host "  npm run dev" -ForegroundColor Cyan
Write-Host ""
Write-Host "Then open your browser to:" -ForegroundColor Yellow
Write-Host "  http://localhost:5173" -ForegroundColor Cyan
Write-Host ""
Write-Host "To stop Docker services:" -ForegroundColor Yellow
Write-Host "  docker-compose down" -ForegroundColor Cyan
Write-Host ""
Write-Host "For detailed instructions, see:" -ForegroundColor Yellow
Write-Host "  DOCKER_SETUP_GUIDE.md" -ForegroundColor Cyan
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Happy coding!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
