@echo off
echo Starting WP Content Optimizer UI...
echo.
npm install --silent
echo Opening browser...
start http://localhost:3000
node src/server.js
pause
