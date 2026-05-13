@echo off
echo Updating from GitHub...
git pull origin claude/plan-tool-improvements-U6ZxC
echo.
echo Installing dependencies...
npm install --silent
echo.
echo Starting WP Content Optimizer UI...
echo Browser opens automatically once the server is ready.
echo Press Ctrl+C to stop the server.
echo.
node src/server.js
pause
