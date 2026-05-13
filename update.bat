@echo off
echo Updating wp-content-optimizer from GitHub...

git pull origin main
if errorlevel 1 (
    echo ERROR: git pull failed.
    pause
    exit /b 1
)

echo Checking for dependency changes...
git diff HEAD@{1} HEAD -- package.json | findstr "." >nul 2>&1
if not errorlevel 1 (
    echo package.json changed, running npm install...
    npm install
)

echo.
echo Done! Tool is up to date.
pause
