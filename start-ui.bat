@echo off
echo ============================================
echo  WP Content Optimizer - Starting...
echo ============================================
echo.

echo [1/3] Updating from GitHub...
git pull origin main
if %errorlevel% neq 0 (
    echo WARNING: git pull failed, continuing with local version...
)
echo.

echo [2/3] Installing dependencies...
npm install
if %errorlevel% neq 0 (
    echo ERROR: npm install failed.
    cmd /k
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
cmd /k
