@echo off
setlocal

echo ============================================
echo   STOPPING SERVICES
echo ============================================
echo.

where docker >nul 2>&1
if %errorlevel% neq 0 (
  echo [ERROR] Docker CLI not found.
  exit /b 1
)

docker compose stop
if %errorlevel% neq 0 (
  echo [ERROR] Failed to stop one or more services.
  exit /b 1
)

echo [INFO] Stopping frontend process on port 5173...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":5173" ^| findstr "LISTENING"') do (
  taskkill /PID %%p /F >nul 2>&1
)

echo.
echo [OK] Services stopped.
echo.
docker compose ps
echo.
endlocal
