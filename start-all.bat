@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

set "FRONTEND_PORT=5173"
set "BACKEND_HEALTH_URL=http://localhost:3000/health"

echo ============================================
echo   STARTING SERVICES
echo ============================================
echo.

call :require_cmd docker "Docker CLI"
if errorlevel 1 exit /b 1

call :require_cmd npm "npm"
if errorlevel 1 exit /b 1

echo [STEP] Starting Docker services (postgres, redis, backend, python-worker)...
docker compose up -d postgres redis backend python-worker
if errorlevel 1 (
  echo [ERROR] Failed to start one or more Docker services.
  exit /b 1
)

echo [STEP] Waiting for backend health at %BACKEND_HEALTH_URL% ...
set "status=0"
for /L %%i in (1,1,30) do (
  for /f %%s in ('powershell -NoProfile -Command "try { (Invoke-WebRequest -Uri '%BACKEND_HEALTH_URL%' -UseBasicParsing -TimeoutSec 2).StatusCode } catch { 0 }"') do set "status=%%s"
  if "!status!"=="200" goto :backend_ready
  timeout /t 1 /nobreak >nul
)
echo [WARN] Backend health check timed out. Continuing startup.
goto :frontend_start

:backend_ready
echo [OK] Backend health check passed.

:frontend_start
echo [STEP] Stopping old frontend process on port %FRONTEND_PORT% (if any)...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /R /C:":%FRONTEND_PORT% .*LISTENING"') do (
  taskkill /PID %%p /F >nul 2>&1
)
taskkill /FI "WINDOWTITLE eq Territory Frontend*" /F >nul 2>&1

echo [STEP] Starting frontend locally on port %FRONTEND_PORT%...
powershell -NoProfile -Command "$wd='%~dp0frontend'; Start-Process -FilePath 'npm.cmd' -ArgumentList @('run','dev','--','--host','0.0.0.0','--port','%FRONTEND_PORT%') -WorkingDirectory $wd -WindowStyle Minimized | Out-Null"
if errorlevel 1 (
  echo [ERROR] Failed to start frontend process.
  exit /b 1
)

timeout /t 3 /nobreak >nul
set "frontendPid="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /R /C:":%FRONTEND_PORT% .*LISTENING"') do (
  set "frontendPid=%%p"
  goto :frontend_ok
)

echo [WARN] Frontend is not listening on port %FRONTEND_PORT% yet.
echo [WARN] Verify with: npm run dev in %~dp0frontend
goto :summary

:frontend_ok
echo [OK] Frontend listening on port %FRONTEND_PORT% (PID !frontendPid!).

:summary
echo.
echo [OK] Startup completed.
echo.
docker compose ps
echo.
echo URLs:
echo   Frontend: http://localhost:%FRONTEND_PORT%
echo   Backend : http://localhost:3000
echo   Health  : %BACKEND_HEALTH_URL%
echo.
endlocal
exit /b 0

:require_cmd
where %~1 >nul 2>&1
if errorlevel 1 (
  echo [ERROR] %~2 not found. Please install it and retry.
  exit /b 1
)
exit /b 0
