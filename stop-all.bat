@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "ROOT=%~dp0"
set "FRONTEND_PID_FILE=%ROOT%.frontend-dev.pid"

echo ============================================
echo   STOPPING SERVICES
echo ============================================
echo.

echo [INFO] Stopping local frontend...
set "FRONTEND_STOPPED=0"

if exist "%FRONTEND_PID_FILE%" (
  set /p FRONTEND_PID=<"%FRONTEND_PID_FILE%"
  if defined FRONTEND_PID (
    taskkill /PID !FRONTEND_PID! /T /F >nul 2>&1
    if not errorlevel 1 (
      echo [OK] Stopped frontend process tree ^(PID !FRONTEND_PID!^).
      set "FRONTEND_STOPPED=1"
    )
  )
  del "%FRONTEND_PID_FILE%" >nul 2>&1
)

if "!FRONTEND_STOPPED!"=="0" (
  powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'cmd.exe' -or $_.Name -eq 'node.exe') -and $_.CommandLine -match 'frontend' -and ($_.CommandLine -match 'vite' -or $_.CommandLine -match 'npm run dev') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1
  echo [INFO] PID file not found or stale. Attempted targeted frontend process cleanup.
)

where docker >nul 2>&1
if errorlevel 1 (
  echo [WARN] Docker CLI not found. Skipping Docker service stop.
  goto done
)

docker info >nul 2>&1
if errorlevel 1 (
  echo [WARN] Docker daemon is not running. Skipping Docker service stop.
  goto done
)

echo [INFO] Stopping Docker services...
docker compose stop
if errorlevel 1 (
  echo [ERROR] Failed to stop one or more Docker services.
  exit /b 1
)

:done
echo.
echo [OK] Stop sequence completed.
echo.
where docker >nul 2>&1
if not errorlevel 1 (
  docker info >nul 2>&1
  if not errorlevel 1 (
    docker compose ps
    echo.
  )
)

endlocal
