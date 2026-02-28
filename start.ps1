# Location Pockets System - Quick Start Script (PowerShell)
# This script helps you get started quickly with the development environment on Windows

Write-Host "🚀 Location Pockets System - Quick Start" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if Docker is installed
$dockerInstalled = Get-Command docker -ErrorAction SilentlyContinue
if (-not $dockerInstalled) {
    Write-Host "❌ Docker is not installed. Please install Docker Desktop first." -ForegroundColor Red
    Write-Host "   Visit: https://docs.docker.com/desktop/install/windows-install/" -ForegroundColor Yellow
    exit 1
}

# Check if Docker Compose is installed
$dockerComposeInstalled = Get-Command docker-compose -ErrorAction SilentlyContinue
if (-not $dockerComposeInstalled) {
    Write-Host "❌ Docker Compose is not installed. Please install Docker Desktop first." -ForegroundColor Red
    Write-Host "   Visit: https://docs.docker.com/desktop/install/windows-install/" -ForegroundColor Yellow
    exit 1
}

Write-Host "✅ Docker and Docker Compose are installed" -ForegroundColor Green
Write-Host ""

# Ask user for setup type
Write-Host "Choose setup type:" -ForegroundColor Cyan
Write-Host "1) Docker Compose (Recommended for quick start)"
Write-Host "2) Manual setup (For development)"
Write-Host ""
$choice = Read-Host "Enter choice [1-2]"

switch ($choice) {
    "1" {
        Write-Host ""
        Write-Host "🐳 Starting with Docker Compose..." -ForegroundColor Cyan
        Write-Host ""
        
        # Create .env files if they don't exist
        if (-not (Test-Path "backend\.env")) {
            Write-Host "📝 Creating backend\.env from example..." -ForegroundColor Yellow
            Copy-Item "backend\.env.example" "backend\.env"
        }
        
        if (-not (Test-Path "frontend\.env")) {
            Write-Host "📝 Creating frontend\.env from example..." -ForegroundColor Yellow
            Copy-Item "frontend\.env.example" "frontend\.env"
        }
        
        # Start services
        Write-Host ""
        Write-Host "🚀 Starting services..." -ForegroundColor Cyan
        docker-compose up -d
        
        Write-Host ""
        Write-Host "⏳ Waiting for services to be ready..." -ForegroundColor Yellow
        Start-Sleep -Seconds 10
        
        # Run migrations
        Write-Host ""
        Write-Host "🗄️  Running database migrations..." -ForegroundColor Cyan
        docker-compose exec backend npm run migrate
        
        Write-Host ""
        Write-Host "✅ Setup complete!" -ForegroundColor Green
        Write-Host ""
        Write-Host "📍 Services are running at:" -ForegroundColor Cyan
        Write-Host "   - Frontend: http://localhost:5173" -ForegroundColor White
        Write-Host "   - Backend API: http://localhost:3000" -ForegroundColor White
        Write-Host "   - API Health: http://localhost:3000/health" -ForegroundColor White
        Write-Host "   - PostgreSQL: localhost:5432" -ForegroundColor White
        Write-Host "   - Redis: localhost:6379" -ForegroundColor White
        Write-Host ""
        Write-Host "📊 View logs:" -ForegroundColor Cyan
        Write-Host "   docker-compose logs -f" -ForegroundColor White
        Write-Host ""
        Write-Host "🛑 Stop services:" -ForegroundColor Cyan
        Write-Host "   docker-compose down" -ForegroundColor White
    }
    
    "2" {
        Write-Host ""
        Write-Host "🔧 Manual setup instructions:" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "1. Install PostgreSQL 15 with PostGIS extension"
        Write-Host "2. Install Redis 7"
        Write-Host "3. Install Node.js 20 LTS"
        Write-Host ""
        Write-Host "4. Backend setup:"
        Write-Host "   cd backend"
        Write-Host "   npm install"
        Write-Host "   Copy-Item .env.example .env"
        Write-Host "   # Edit .env with your database credentials"
        Write-Host "   npm run migrate"
        Write-Host "   npm run dev"
        Write-Host ""
        Write-Host "5. Frontend setup (in a new terminal):"
        Write-Host "   cd frontend"
        Write-Host "   npm install"
        Write-Host "   Copy-Item .env.example .env"
        Write-Host "   npm run dev"
        Write-Host ""
        Write-Host "📖 For detailed instructions, see SETUP_GUIDE.md" -ForegroundColor Yellow
    }
    
    default {
        Write-Host "❌ Invalid choice" -ForegroundColor Red
        exit 1
    }
}

Write-Host ""
Write-Host "🎉 Happy coding!" -ForegroundColor Green
