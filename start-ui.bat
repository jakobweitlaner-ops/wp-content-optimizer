@echo off
echo WP Content Optimizer wird gestartet...
echo.

echo [1/3] Update wird geprueft...
git pull origin claude/plan-tool-improvements-U6ZxC
if errorlevel 1 (
    echo WARNUNG: Update fehlgeschlagen. Starte mit lokaler Version...
    echo.
)

echo.
echo [2/3] Abhaengigkeiten werden geprueft...
git diff HEAD@{1} HEAD -- package.json 2>nul | findstr "." >nul 2>&1
if not errorlevel 1 (
    echo package.json geaendert - npm install wird ausgefuehrt...
    npm install
)

echo.
echo [3/3] Server wird gestartet...
echo.
echo Druecke Ctrl+C um den Server zu stoppen.
echo Dieses Fenster muss geoeffnet bleiben.
echo.
node src/server.js
echo.
echo Server gestoppt.
pause
