@echo off
echo Updating from GitHub...
git pull origin main
echo.
echo Installing dependencies...
npm install --silent
echo.
echo Starting WP Content Optimizer UI...
echo Browser opens automatically once the server is ready.
echo Press Ctrl+C to stop the server.
echo.
node src/server.js
echo.
if %errorlevel% neq 0 (
  echo ERROR: Server exited with code %errorlevel%.
) else (
  echo Server stopped.
)
echo Press any key to close this window...
pause > nul
