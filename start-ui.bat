@echo off
echo WP Content Optimizer wird gestartet...
echo.

echo [1/4] Laufenden Server stoppen (falls vorhanden)...
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":3000 " ^| findstr "LISTENING"') do (
    taskkill /PID %%a /F >nul 2>&1
)

echo [2/4] Update wird geprueft...
git pull origin claude/plan-tool-improvements-U6ZxC
if errorlevel 1 (
    echo WARNUNG: Update fehlgeschlagen. Starte mit lokaler Version...
    echo.
)

echo.
echo [3/4] Abhaengigkeiten werden geprueft...
git diff HEAD@{1} HEAD -- package.json 2>nul | findstr "." >nul 2>&1
if not errorlevel 1 (
    echo package.json geaendert - npm install wird ausgefuehrt...
    npm install
)

echo.
echo [4/4] Server wird gestartet...
echo.
echo Druecke Ctrl+C um den Server zu stoppen.
echo Dieses Fenster muss geoeffnet bleiben.
echo.
node src/server.js
echo.
echo Server gestoppt.
pause
