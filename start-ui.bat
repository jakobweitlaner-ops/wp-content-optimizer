@echo off
echo Updating from GitHub...
git pull origin main
echo.
echo Installing dependencies...
npm install --silent
echo.
echo Starting WP Content Optimizer UI...
start http://localhost:3000
node src/server.js
pause
