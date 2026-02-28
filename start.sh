#!/bin/bash

# Location Pockets System - Quick Start Script
# This script helps you get started quickly with the development environment

set -e

echo "🚀 Location Pockets System - Quick Start"
echo "========================================"
echo ""

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    echo "   Visit: https://docs.docker.com/get-docker/"
    exit 1
fi

# Check if Docker Compose is installed
if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose is not installed. Please install Docker Compose first."
    echo "   Visit: https://docs.docker.com/compose/install/"
    exit 1
fi

echo "✅ Docker and Docker Compose are installed"
echo ""

# Ask user for setup type
echo "Choose setup type:"
echo "1) Docker Compose (Recommended for quick start)"
echo "2) Manual setup (For development)"
echo ""
read -p "Enter choice [1-2]: " choice

case $choice in
    1)
        echo ""
        echo "🐳 Starting with Docker Compose..."
        echo ""
        
        # Create .env files if they don't exist
        if [ ! -f backend/.env ]; then
            echo "📝 Creating backend/.env from example..."
            cp backend/.env.example backend/.env
        fi
        
        if [ ! -f frontend/.env ]; then
            echo "📝 Creating frontend/.env from example..."
            cp frontend/.env.example frontend/.env
        fi
        
        # Start services
        echo ""
        echo "🚀 Starting services..."
        docker-compose up -d
        
        echo ""
        echo "⏳ Waiting for services to be ready..."
        sleep 10
        
        # Run migrations
        echo ""
        echo "🗄️  Running database migrations..."
        docker-compose exec backend npm run migrate
        
        echo ""
        echo "✅ Setup complete!"
        echo ""
        echo "📍 Services are running at:"
        echo "   - Frontend: http://localhost:5173"
        echo "   - Backend API: http://localhost:3000"
        echo "   - API Health: http://localhost:3000/health"
        echo "   - PostgreSQL: localhost:5432"
        echo "   - Redis: localhost:6379"
        echo ""
        echo "📊 View logs:"
        echo "   docker-compose logs -f"
        echo ""
        echo "🛑 Stop services:"
        echo "   docker-compose down"
        ;;
        
    2)
        echo ""
        echo "🔧 Manual setup instructions:"
        echo ""
        echo "1. Install PostgreSQL 15 with PostGIS extension"
        echo "2. Install Redis 7"
        echo "3. Install Node.js 20 LTS"
        echo ""
        echo "4. Backend setup:"
        echo "   cd backend"
        echo "   npm install"
        echo "   cp .env.example .env"
        echo "   # Edit .env with your database credentials"
        echo "   npm run migrate"
        echo "   npm run dev"
        echo ""
        echo "5. Frontend setup (in a new terminal):"
        echo "   cd frontend"
        echo "   npm install"
        echo "   cp .env.example .env"
        echo "   npm run dev"
        echo ""
        echo "📖 For detailed instructions, see SETUP_GUIDE.md"
        ;;
        
    *)
        echo "❌ Invalid choice"
        exit 1
        ;;
esac

echo ""
echo "🎉 Happy coding!"
