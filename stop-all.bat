@echo off
echo ============================================
echo   STOPPING ALL SERVICES
echo ============================================
echo.

echo 1. Stopping Python Worker...
taskkill /F /IM python.exe 2>nul
if %errorlevel% equ 0 (
    echo    [OK] Python worker stopped
) else (
    echo    [-] No Python worker running
)

echo 2. Stopping Backend (Node.js)...
taskkill /F /IM node.exe 2>nul
if %errorlevel% equ 0 (
    echo    [OK] Backend stopped
) else (
    echo    [-] No backend running
)

echo 3. Stopping Docker Containers...
docker-compose down
echo    [OK] Docker containers stopped

echo.
echo ============================================
echo   ALL SERVICES STOPPED
echo ============================================
echo.
pause
