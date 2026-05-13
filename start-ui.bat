@echo off

:: If not already running as child process, relaunch in a persistent cmd window
if "%1"=="--run" goto :run
start "WP Content Optimizer" cmd /k ""%~f0" --run"
exit /b

:run
cd /d "%~dp0"
echo ============================================
echo  WP Content Optimizer - Starting...
echo ============================================
echo.

echo [1/3] Updating from GitHub...
call git pull origin main
if %errorlevel% neq 0 (
    echo WARNING: git pull failed, continuing with local version...
)
echo.

echo [2/3] Installing dependencies...
call npm install
if %errorlevel% neq 0 (
    echo.
    echo ERROR: npm install failed. See errors above.
    pause
    exit /b 1
)
echo.

echo [3/3] Starting server...
echo Browser opens automatically.
echo Press Ctrl+C to stop.
echo.
node src/server.js

echo.
if %errorlevel% neq 0 (
    echo ERROR: Server crashed with code %errorlevel%.
) else (
    echo Server stopped.
)
echo.
pause
