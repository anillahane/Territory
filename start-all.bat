@echo off
setlocal

echo ============================================
echo   STARTING SERVICES
echo ============================================
echo.

where docker >nul 2>&1
if %errorlevel% neq 0 (
  echo [ERROR] Docker CLI not found. Start Docker Desktop and try again.
  exit /b 1
)

docker compose up -d postgres redis backend python-worker
if %errorlevel% neq 0 (
  echo [ERROR] Failed to start one or more services.
  exit /b 1
)

echo [INFO] Starting frontend locally on port 5173...
start "Territory Frontend" cmd /k "cd /d ""%~dp0frontend"" && npm run dev -- --host 0.0.0.0 --port 5173"

echo.
echo [OK] Services started.
echo.
docker compose ps
echo.
echo URLs:
echo   Frontend: http://localhost:5173
echo   Backend : http://localhost:3000
echo   Health  : http://localhost:3000/health
echo.
endlocal
