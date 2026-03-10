@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

set "BACKEND_HEALTH_URL=http://localhost:3000/health"
set "FRONTEND_PORT=5173"

echo ============================================
echo   ONE-CLICK DEPLOYMENT
echo ============================================
echo.

where docker >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Docker CLI not found. Install Docker Desktop first.
  exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
  echo [ERROR] npm not found. Install Node.js first.
  exit /b 1
)

echo [STEP] Pulling latest images (best effort)...
docker compose pull --ignore-pull-failures

echo [STEP] Rebuilding service images (backend + python-worker)...
docker compose build backend python-worker
if errorlevel 1 (
  echo [ERROR] Failed to build service images.
  exit /b 1
)

echo [STEP] Starting backend stack...
docker compose up -d postgres redis backend python-worker
if errorlevel 1 (
  echo [ERROR] Failed to start backend stack.
  exit /b 1
)

echo [STEP] Waiting for backend health...
set "status=0"
for /L %%i in (1,1,40) do (
  for /f %%s in ('powershell -NoProfile -Command "try { (Invoke-WebRequest -Uri '%BACKEND_HEALTH_URL%' -UseBasicParsing -TimeoutSec 2).StatusCode } catch { 0 }"') do set "status=%%s"
  if "!status!"=="200" goto :backend_ready
  timeout /t 1 /nobreak >nul
)
echo [ERROR] Backend did not become healthy in time.
exit /b 1

:backend_ready
echo [OK] Backend is healthy.

echo [STEP] Running database migrations...
docker compose exec -T backend npm run migrate
if errorlevel 1 (
  echo [ERROR] Database migration failed.
  exit /b 1
)
echo [OK] Migrations completed.

echo [STEP] Restarting frontend...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /R /C:":%FRONTEND_PORT% .*LISTENING"') do (
  taskkill /PID %%p /F >nul 2>&1
)
taskkill /FI "WINDOWTITLE eq Territory Frontend*" /F >nul 2>&1

powershell -NoProfile -Command "$wd='%~dp0frontend'; Start-Process -FilePath 'npm.cmd' -ArgumentList @('run','dev','--','--host','0.0.0.0','--port','%FRONTEND_PORT%') -WorkingDirectory $wd -WindowStyle Minimized | Out-Null"
if errorlevel 1 (
  echo [ERROR] Failed to start frontend process.
  exit /b 1
)
timeout /t 3 /nobreak >nul

echo.
echo [OK] One-click deployment completed.
echo.
echo URLs:
echo   Frontend: http://localhost:%FRONTEND_PORT%
echo   Backend : http://localhost:3000
echo   Health  : %BACKEND_HEALTH_URL%
echo.
docker compose ps
echo.
endlocal
