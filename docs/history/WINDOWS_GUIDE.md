# Windows Development Guide

This guide provides Windows-specific instructions for developing the Location Pockets System.

## 🚀 Quick Start on Windows

### Using PowerShell (Recommended)

```powershell
# Run the PowerShell start script
.\start.ps1

# Or manually with Docker Compose
docker-compose up -d

# Run migrations
docker-compose exec backend npm run migrate

# View logs
docker-compose logs -f backend
docker-compose logs -f frontend

# Stop services
docker-compose down
```

## 📝 Common Windows Commands

### PowerShell Command Equivalents

| Linux/Mac Command | Windows PowerShell Command |
|-------------------|----------------------------|
| `chmod +x file.sh` | Not needed (use `.ps1` files) |
| `cd backend && npm test` | `cd backend; npm test` |
| `ls -la` | `Get-ChildItem` or `dir` |
| `cat file.txt` | `Get-Content file.txt` or `type file.txt` |
| `rm -rf folder` | `Remove-Item -Recurse -Force folder` |
| `cp file1 file2` | `Copy-Item file1 file2` |
| `mv file1 file2` | `Move-Item file1 file2` |
| `mkdir folder` | `New-Item -ItemType Directory folder` or `mkdir folder` |
| `touch file.txt` | `New-Item file.txt` |
| `export VAR=value` | `$env:VAR="value"` |

### Running Multiple Commands

In PowerShell, use semicolon (`;`) instead of `&&`:

```powershell
# ❌ Wrong (Linux/Mac)
cd backend && npm test

# ✅ Correct (Windows PowerShell)
cd backend; npm test

# Or use separate commands
cd backend
npm test
```

## 🐳 Docker on Windows

### Prerequisites

1. **Install Docker Desktop for Windows**
   - Download from: https://docs.docker.com/desktop/install/windows-install/
   - Requires Windows 10/11 Pro, Enterprise, or Education (64-bit)
   - Enable WSL 2 backend (recommended)

2. **Enable WSL 2** (if not already enabled)
   ```powershell
   # Run as Administrator
   wsl --install
   wsl --set-default-version 2
   ```

3. **Verify Installation**
   ```powershell
   docker --version
   docker-compose --version
   ```

### Docker Commands

```powershell
# Start services
docker-compose up -d

# View running containers
docker-compose ps

# View logs
docker-compose logs -f

# Stop services
docker-compose down

# Rebuild containers
docker-compose up -d --build

# Execute command in container
docker-compose exec backend npm run migrate
docker-compose exec backend npm test

# Access container shell
docker-compose exec backend sh
docker-compose exec backend /bin/bash

# Remove all containers and volumes
docker-compose down -v
```

## 📦 Node.js Development

### Install Node.js

1. Download Node.js 20 LTS from: https://nodejs.org/
2. Or use nvm-windows: https://github.com/coreybutler/nvm-windows

```powershell
# Using nvm-windows
nvm install 20
nvm use 20
node --version
npm --version
```

### Backend Development

```powershell
# Navigate to backend
cd backend

# Install dependencies
npm install

# Create .env file
Copy-Item .env.example .env

# Edit .env (use notepad or VS Code)
notepad .env
# or
code .env

# Run migrations
npm run migrate

# Start development server
npm run dev

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Run linter
npm run lint
```

### Frontend Development

```powershell
# Navigate to frontend (in a new PowerShell window)
cd frontend

# Install dependencies
npm install

# Create .env file
Copy-Item .env.example .env

# Start development server
npm run dev

# Run tests
npm test

# Build for production
npm run build

# Preview production build
npm run preview
```

## 🗄️ Database Setup (Manual)

### Install PostgreSQL with PostGIS

1. **Download PostgreSQL 15**
   - https://www.postgresql.org/download/windows/
   - Or use installer: https://www.enterprisedb.com/downloads/postgres-postgresql-downloads

2. **Install PostGIS**
   - During PostgreSQL installation, select PostGIS in Stack Builder
   - Or download from: https://postgis.net/install/

3. **Create Database**
   ```powershell
   # Using psql (add to PATH or use full path)
   psql -U postgres

   # In psql:
   CREATE DATABASE location_pockets;
   \c location_pockets
   CREATE EXTENSION postgis;
   \q
   ```

4. **Verify PostGIS**
   ```powershell
   psql -U postgres -d location_pockets -c "SELECT PostGIS_Version();"
   ```

### Install Redis

**Option 1: Using Docker (Recommended)**
```powershell
docker run -d -p 6379:6379 --name redis redis:7-alpine
```

**Option 2: Using WSL**
```powershell
# In WSL terminal
sudo apt-get update
sudo apt-get install redis-server
sudo service redis-server start
```

**Option 3: Windows Native**
- Download from: https://github.com/microsoftarchive/redis/releases
- Or use Memurai: https://www.memurai.com/

## 🔧 Development Tools

### Recommended Tools

1. **Visual Studio Code**
   - Download: https://code.visualstudio.com/
   - Extensions:
     - ESLint
     - Prettier
     - Docker
     - PostgreSQL
     - Thunder Client (API testing)

2. **Windows Terminal**
   - Download from Microsoft Store
   - Better than default PowerShell

3. **Git for Windows**
   - Download: https://git-scm.com/download/win
   - Includes Git Bash

### VS Code Configuration

Create `.vscode/settings.json`:
```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  },
  "files.eol": "\n",
  "typescript.tsdk": "node_modules/typescript/lib"
}
```

## 🐛 Troubleshooting

### Docker Issues

**Problem**: Docker daemon not running
```powershell
# Solution: Start Docker Desktop
# Check system tray for Docker icon
# Or restart Docker Desktop
```

**Problem**: Port already in use
```powershell
# Find process using port
netstat -ano | findstr :3000

# Kill process (replace PID)
taskkill /PID <PID> /F
```

**Problem**: WSL 2 not enabled
```powershell
# Run as Administrator
wsl --install
wsl --set-default-version 2

# Restart computer
```

### Node.js Issues

**Problem**: `npm install` fails
```powershell
# Clear npm cache
npm cache clean --force

# Delete node_modules and package-lock.json
Remove-Item -Recurse -Force node_modules
Remove-Item package-lock.json

# Reinstall
npm install
```

**Problem**: Permission errors
```powershell
# Run PowerShell as Administrator
# Or change npm prefix
npm config set prefix "$env:APPDATA\npm"
```

### PostgreSQL Issues

**Problem**: Connection refused
```powershell
# Check if PostgreSQL is running
Get-Service postgresql*

# Start service
Start-Service postgresql-x64-15

# Or use Services app (services.msc)
```

**Problem**: Password authentication failed
```powershell
# Edit pg_hba.conf (usually in C:\Program Files\PostgreSQL\15\data)
# Change method from 'scram-sha-256' to 'md5' or 'trust' for local connections
# Restart PostgreSQL service
```

### Redis Issues

**Problem**: Redis not connecting
```powershell
# If using Docker
docker ps | findstr redis
docker start redis

# If using WSL
wsl
sudo service redis-server start
```

## 📝 Environment Variables

### Setting Environment Variables in PowerShell

**Temporary (current session only)**
```powershell
$env:NODE_ENV = "development"
$env:DB_HOST = "localhost"
```

**Permanent (user level)**
```powershell
[System.Environment]::SetEnvironmentVariable("NODE_ENV", "development", "User")
```

**Using .env files**
```powershell
# Backend and frontend use dotenv
# Just edit .env files directly
notepad backend\.env
notepad frontend\.env
```

## 🧪 Testing

### Run Tests

```powershell
# Backend tests
cd backend
npm test

# With coverage
npm run test:coverage

# Watch mode
npm run test:watch

# Frontend tests
cd frontend
npm test

# With UI
npm run test:ui
```

### View Coverage Reports

```powershell
# Backend
cd backend
npm run test:coverage
Start-Process coverage\lcov-report\index.html

# Frontend
cd frontend
npm run test:coverage
Start-Process coverage\index.html
```

## 🚀 Deployment

### Build for Production

```powershell
# Backend (no build needed, just copy files)
cd backend
npm ci --only=production

# Frontend
cd frontend
npm run build
# Output in dist/ folder
```

### Docker Build

```powershell
# Build backend image
docker build -t location-pockets-backend:latest ./backend

# Build frontend image
docker build -t location-pockets-frontend:latest ./frontend

# Run production containers
docker-compose -f docker-compose.prod.yml up -d
```

## 📚 Additional Resources

### Windows-Specific

- **WSL 2 Documentation**: https://docs.microsoft.com/en-us/windows/wsl/
- **Docker Desktop for Windows**: https://docs.docker.com/desktop/windows/
- **Node.js on Windows**: https://nodejs.org/en/download/
- **PostgreSQL on Windows**: https://www.postgresql.org/download/windows/

### PowerShell

- **PowerShell Documentation**: https://docs.microsoft.com/en-us/powershell/
- **PowerShell Gallery**: https://www.powershellgallery.com/

### Development Tools

- **VS Code**: https://code.visualstudio.com/docs
- **Windows Terminal**: https://docs.microsoft.com/en-us/windows/terminal/

## 💡 Tips

1. **Use Windows Terminal** instead of default PowerShell for better experience
2. **Enable WSL 2** for better Docker performance
3. **Use VS Code** with Remote-WSL extension for seamless development
4. **Set execution policy** if scripts don't run:
   ```powershell
   Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
   ```
5. **Use Git Bash** if you prefer Unix-like commands
6. **Keep Docker Desktop running** in the background
7. **Use `.ps1` scripts** instead of `.sh` on Windows

## 🆘 Getting Help

If you encounter issues:

1. Check this guide first
2. Review [SETUP_GUIDE.md](SETUP_GUIDE.md)
3. Check [DEVELOPMENT_STATUS.md](DEVELOPMENT_STATUS.md)
4. Search for error messages online
5. Create an issue on GitHub
6. Contact the development team

---

**Happy coding on Windows! 🎉**
