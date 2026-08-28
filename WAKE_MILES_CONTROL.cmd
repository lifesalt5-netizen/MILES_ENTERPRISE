@echo off
setlocal
set "ROOT=C:\P2GC_Intelligence\MILES_ENTERPRISE"

if not exist "%ROOT%\.git" (
  echo ERROR: MILES production checkout not found at %ROOT%
  exit /b 2
)

cd /d "%ROOT%" || exit /b 2

echo ============================================================
echo MILES CONTROL WAKE
echo ============================================================
echo Updating production checkout to current main without destructive reset...

git fetch origin main
if errorlevel 1 exit /b 2

git checkout main
if errorlevel 1 exit /b 2

git pull --ff-only origin main
if errorlevel 1 exit /b 2

rem Block tracked source/control/config drift; never reset or delete anything.
git diff --quiet --exit-code HEAD -- API CORE SERVICES SCRIPTS CONNECTORS WORKERS TESTS CONFIG .github StartMilesRemoteExecutionBridge.js StartAutonomousCOO.js WAKE_MILES_CONTROL.cmd package.json package-lock.json
if errorlevel 1 (
  echo ERROR: Production source/control/config files have local tracked drift. No files were reset or deleted.
  exit /b 2
)

where pm2.cmd >nul 2>nul
if errorlevel 1 (
  echo ERROR: pm2.cmd not found.
  exit /b 2
)

echo Restarting only the persistent MILES control owner...
pm2 restart miles-autonomous-coo --update-env
if errorlevel 1 (
  echo Existing control owner was not restartable. Attempting guarded start...
  pm2 start SCRIPTS\RuntimeGenerationGuard.js --name miles-autonomous-coo -- --runtime miles-autonomous-coo --entry StartAutonomousCOO.js --arg --loop
  if errorlevel 1 (
    echo ERROR: Failed to start miles-autonomous-coo.
    exit /b 2
  )
)

pm2 save >nul
if errorlevel 1 (
  echo WARNING: PM2 state save failed. Control owner may still be running for this session.
)

timeout /t 5 /nobreak >nul
pm2 describe miles-autonomous-coo | findstr /I "status online"
if errorlevel 1 (
  echo ERROR: miles-autonomous-coo is not confirmed online.
  exit /b 2
)

echo.
echo MILES_CONTROL_WAKE_GREEN
echo The control owner is online. The GitHub bridge should consume the pending directive automatically.
exit /b 0
