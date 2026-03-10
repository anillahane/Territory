@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "FRONTEND_PORT=5173"

echo ============================================
echo   STOPPING SERVICES
echo ============================================
echo.

where docker >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Docker CLI not found.
  exit /b 1
)

echo [STEP] Stopping frontend process on port %FRONTEND_PORT%...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /R /C:":%FRONTEND_PORT% .*LISTENING"') do (
  taskkill /PID %%p /F >nul 2>&1
)
taskkill /FI "WINDOWTITLE eq Territory Frontend*" /F >nul 2>&1

echo [STEP] Stopping Docker services...
docker compose stop backend python-worker frontend postgres redis
if errorlevel 1 (
  echo [ERROR] Failed to stop one or more Docker services.
  exit /b 1
)

echo.
echo [OK] Services stopped.
echo.
docker compose ps
echo.
endlocal
