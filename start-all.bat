@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "ROOT=%~dp0"

echo ============================================
echo   STARTING SERVICES
echo ============================================
echo.

where docker >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Docker CLI not found. Start Docker Desktop and try again.
  exit /b 1
)

docker info >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Docker daemon is not running. Start Docker Desktop and try again.
  exit /b 1
)

echo [INFO] Starting Docker services (postgres, redis, backend, python-worker)...
docker compose up -d postgres redis backend python-worker
if errorlevel 1 (
  echo [ERROR] Failed to start one or more Docker services.
  exit /b 1
)

echo [INFO] Waiting for backend health at http://localhost:3000/health ...
set /a ATTEMPT=0
set /a MAX_ATTEMPTS=60

:wait_backend
set /a ATTEMPT+=1
curl -fsS --max-time 2 http://localhost:3000/health >nul 2>&1
if not errorlevel 1 goto backend_ready
if !ATTEMPT! GEQ !MAX_ATTEMPTS! goto backend_timeout

echo [INFO] Backend not ready yet (!ATTEMPT!/!MAX_ATTEMPTS!).
ping 127.0.0.1 -n 3 >nul
goto wait_backend

:backend_timeout
echo [ERROR] Backend did not become healthy in time.
docker compose ps
exit /b 1

:backend_ready
echo [OK] Backend is healthy.

echo [INFO] Running database migrations...
docker compose exec -T backend npm run migrate
if errorlevel 1 (
  echo [ERROR] Migration failed.
  exit /b 1
)
echo [OK] Migrations completed.

echo [INFO] Starting frontend locally on port 5173...
start "Territory Frontend" cmd /k "cd /d ""%ROOT%frontend"" && npm run dev -- --host 0.0.0.0 --port 5173"

echo [INFO] Waiting for frontend at http://localhost:5173 ...
set /a FRONTEND_ATTEMPT=0
set /a FRONTEND_MAX_ATTEMPTS=45

:wait_frontend
set /a FRONTEND_ATTEMPT+=1
curl -fsS --max-time 2 http://localhost:5173 >nul 2>&1
if not errorlevel 1 goto frontend_ready
if !FRONTEND_ATTEMPT! GEQ !FRONTEND_MAX_ATTEMPTS! goto frontend_timeout
ping 127.0.0.1 -n 3 >nul
goto wait_frontend

:frontend_timeout
echo [WARN] Frontend did not return HTTP 200 yet. It may still be starting.
goto show_status

:frontend_ready
echo [OK] Frontend is reachable.

:show_status
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
