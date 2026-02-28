@echo off
echo ============================================
echo   STARTING ALL SERVICES
echo ============================================
echo.

echo 1. Starting Docker Containers (PostgreSQL + Redis)...
docker-compose up -d
timeout /t 5 /nobreak >nul
echo    [OK] Docker containers started
echo.

echo 2. Waiting for PostgreSQL to be ready...
set /a attempts=0
:wait_postgres
set /a attempts+=1
docker exec location-pockets-db pg_isready -U postgres >nul 2>&1
if %errorlevel% equ 0 (
    echo    [OK] PostgreSQL is ready
    goto postgres_ready
)
if %attempts% geq 30 (
    echo    [ERROR] PostgreSQL failed to start
    pause
    exit /b 1
)
echo    [-] Attempt %attempts%/30...
timeout /t 2 /nobreak >nul
goto wait_postgres

:postgres_ready
echo.

echo 3. Starting Backend (Node.js on port 3000)...
start "Backend API" cmd /k "cd backend && npm start"
timeout /t 5 /nobreak >nul
echo    [OK] Backend started
echo.

echo 4. Starting Python Worker...
start "Python Worker" cmd /k "cd backend-worker && python worker.py"
timeout /t 3 /nobreak >nul
echo    [OK] Python worker started
echo.

echo 5. Starting Frontend (Vite on port 5173)...
start "Frontend" cmd /k "cd frontend && npm run dev"
timeout /t 3 /nobreak >nul
echo    [OK] Frontend started
echo.

echo ============================================
echo   ALL SERVICES STARTED
echo ============================================
echo.
echo Services:
echo   - PostgreSQL: localhost:5434
echo   - Redis: localhost:6379
echo   - Backend API: http://localhost:3000
echo   - Frontend: http://localhost:5173
echo   - Python Worker: Running in background
echo.
echo All services are running in separate windows.
echo Close this window or press any key to exit.
echo.
pause
