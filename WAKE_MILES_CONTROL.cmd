@echo off
setlocal
set "ROOT=C:\P2GC_Intelligence\MILES_ENTERPRISE"
set "WAKE_EXIT=2"

rem Non-interactive, fail-fast Git transport for this human recovery launcher.
set "GIT_TERMINAL_PROMPT=0"
set "GIT_CONFIG_COUNT=2"
set "GIT_CONFIG_KEY_0=http.lowSpeedLimit"
set "GIT_CONFIG_VALUE_0=1"
set "GIT_CONFIG_KEY_1=http.lowSpeedTime"
set "GIT_CONFIG_VALUE_1=20"

if not exist "%ROOT%\.git" (
  echo ERROR: MILES production checkout not found at %ROOT%
  goto :FAIL
)

cd /d "%ROOT%" || goto :FAIL

echo ============================================================
echo MILES CONTROL WAKE
echo ============================================================
echo Updating production checkout to current main without destructive reset...

git fetch origin main
if errorlevel 1 (
  echo ERROR: git fetch origin main failed.
  goto :FAIL
)

git checkout main
if errorlevel 1 (
  echo ERROR: git checkout main failed.
  goto :FAIL
)

git pull --ff-only origin main
if errorlevel 1 (
  echo ERROR: git pull --ff-only origin main failed.
  goto :FAIL
)

rem Block tracked source/control/config drift; never reset or delete anything.
git diff --quiet --exit-code HEAD -- API CORE SERVICES SCRIPTS CONNECTORS WORKERS TESTS CONFIG .github StartMilesRemoteExecutionBridge.js StartAutonomousCOO.js WAKE_MILES_CONTROL.cmd package.json package-lock.json
if errorlevel 1 (
  echo ERROR: Production source/control/config files have local tracked drift. No files were reset or deleted.
  goto :FAIL
)

where pm2.cmd >nul 2>nul
if errorlevel 1 (
  echo ERROR: pm2.cmd not found.
  goto :FAIL
)

echo Restarting only the persistent MILES control owner...
pm2 restart miles-autonomous-coo --update-env
if errorlevel 1 (
  echo Existing control owner was not restartable. Attempting guarded start...
  pm2 start SCRIPTS\RuntimeGenerationGuard.js --name miles-autonomous-coo -- --runtime miles-autonomous-coo --entry StartAutonomousCOO.js --arg --loop
  if errorlevel 1 (
    echo ERROR: Failed to start miles-autonomous-coo.
    goto :FAIL
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
  goto :FAIL
)

set "WAKE_EXIT=0"
echo.
echo MILES_CONTROL_WAKE_GREEN
echo The control owner is online. The GitHub bridge should consume the pending directive automatically.
goto :VISIBLE_EXIT

:FAIL
echo.
echo MILES_CONTROL_WAKE_RED
echo The narrow wake did not complete. No destructive recovery was attempted.

:VISIBLE_EXIT
echo.
echo Press any key to close this window.
pause >nul
exit /b %WAKE_EXIT%
