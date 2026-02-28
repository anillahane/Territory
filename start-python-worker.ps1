# Start Python Batch Processing Worker
# This script starts the Python worker for processing large Excel files

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Python Batch Processing Worker" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if Python is installed
Write-Host "Checking Python installation..." -ForegroundColor Yellow
$pythonVersion = python --version 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Python is not installed or not in PATH" -ForegroundColor Red
    Write-Host "   Please install Python 3.8 or higher from https://www.python.org/" -ForegroundColor Red
    exit 1
}
Write-Host "✅ $pythonVersion" -ForegroundColor Green
Write-Host ""

# Check if Redis is running
Write-Host "Checking Redis connection..." -ForegroundColor Yellow
$redisCheck = docker ps | Select-String "redis"
if (-not $redisCheck) {
    Write-Host "❌ Redis is not running" -ForegroundColor Red
    Write-Host "   Starting Redis with Docker..." -ForegroundColor Yellow
    docker-compose up -d redis
    Start-Sleep -Seconds 3
}
Write-Host "✅ Redis is running" -ForegroundColor Green
Write-Host ""

# Check if PostgreSQL is running
Write-Host "Checking PostgreSQL connection..." -ForegroundColor Yellow
$postgresCheck = docker ps | Select-String "postgres"
if (-not $postgresCheck) {
    Write-Host "❌ PostgreSQL is not running" -ForegroundColor Red
    Write-Host "   Starting PostgreSQL with Docker..." -ForegroundColor Yellow
    docker-compose up -d postgres
    Start-Sleep -Seconds 5
}
Write-Host "✅ PostgreSQL is running" -ForegroundColor Green
Write-Host ""

# Check if virtual environment exists
$venvPath = "backend-worker\venv"
if (-not (Test-Path $venvPath)) {
    Write-Host "Creating Python virtual environment..." -ForegroundColor Yellow
    python -m venv $venvPath
    Write-Host "✅ Virtual environment created" -ForegroundColor Green
    Write-Host ""
}

# Activate virtual environment and install dependencies
Write-Host "Installing Python dependencies..." -ForegroundColor Yellow
& "$venvPath\Scripts\Activate.ps1"
pip install -q -r backend-worker\requirements.txt
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Failed to install dependencies" -ForegroundColor Red
    exit 1
}
Write-Host "✅ Dependencies installed" -ForegroundColor Green
Write-Host ""

# Create uploads directory if it doesn't exist
$uploadsDir = "backend\uploads"
if (-not (Test-Path $uploadsDir)) {
    Write-Host "Creating uploads directory..." -ForegroundColor Yellow
    New-Item -ItemType Directory -Path $uploadsDir | Out-Null
    Write-Host "✅ Uploads directory created" -ForegroundColor Green
    Write-Host ""
}

# Set environment variables
$env:REDIS_URL = "redis://localhost:6379"
$env:DATABASE_URL = "postgresql://postgres:postgres@localhost:5434/location_pockets"
$env:UPLOAD_DIR = "..\backend\uploads"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Starting Python Worker" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Configuration:" -ForegroundColor Yellow
Write-Host "  Redis:    $env:REDIS_URL" -ForegroundColor Gray
Write-Host "  Database: postgresql://localhost:5434/location_pockets" -ForegroundColor Gray
Write-Host "  Uploads:  $uploadsDir" -ForegroundColor Gray
Write-Host ""
Write-Host "Press Ctrl+C to stop the worker" -ForegroundColor Yellow
Write-Host ""

# Start the worker
Set-Location backend-worker
python worker.py
