@echo off
setlocal
set "ROOT=C:\P2GC_Intelligence\MILES_ENTERPRISE"
set "INTELLIGENCE_ROOT=D:\P2GC_Intelligence"

if not exist "%ROOT%\.git" (
  echo ERROR: MILES production checkout not found at %ROOT%
  exit /b 2
)

cd /d "%ROOT%" || exit /b 2

echo ============================================================
echo MILES FINAL GO-LIVE
ECHO ============================================================
echo Updating production checkout to current main without destructive reset...

git fetch origin main
if errorlevel 1 exit /b 2

git checkout main
if errorlevel 1 exit /b 2

git pull --ff-only origin main
if errorlevel 1 exit /b 2

rem Runtime DATA/DATABASE/CONFIG/state artifacts are expected to change in-place.
rem Block only tracked source/control drift; never delete, reset, or hide runtime evidence.
git diff --quiet --exit-code HEAD -- API CORE SERVICES SCRIPTS CONNECTORS WORKERS TESTS .github FINAL_GO_LIVE.cmd package.json package-lock.json
if errorlevel 1 (
  echo ERROR: Production source/control files have local tracked drift. No files were reset or deleted.
  exit /b 2
)

echo Restarting governed MILES production PM2 stack...
pm2 restart miles-command-center miles-api miles-executive-dashboard miles-desktop-ui p2gc-growth-demo p2gc-customer-delivery miles-worker miles-autonomous-coo miles-queue-maintainer
if errorlevel 1 (
  echo ERROR: One or more governed MILES PM2 applications failed to restart.
  exit /b 2
)

timeout /t 5 /nobreak >nul

for %%N in (miles-command-center miles-api miles-executive-dashboard miles-desktop-ui p2gc-growth-demo p2gc-customer-delivery miles-worker miles-autonomous-coo miles-queue-maintainer) do (
  pm2 describe %%N | findstr /C:"status" | findstr /C:"online" >nul
  if errorlevel 1 (
    echo ERROR: PM2 application %%N is not online after restart.
    exit /b 2
  )
)

echo Running definitive FULL GO production acceptance...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "SCRIPTS\RunMilesFullGoAcceptance.ps1" -Root "%ROOT%" -IntelligenceRoot "%INTELLIGENCE_ROOT%"
if errorlevel 1 (
  echo.
  echo FULL GO did not pass. Review the generated MILES_FULL_GO_ACCEPTANCE report and fix only the reported live blocker.
  echo Paid verification was NOT authorized by this launcher.
  exit /b 2
)

echo.
echo FULL_GO_GREEN confirmed. Starting the required 24-hour autonomous soak now.
echo Keep this Windows session and the MILES production machine running for the full observation period.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "SCRIPTS\RunMiles24hAutonomousSoak.ps1" -Root "%ROOT%" -DurationHours 24 -SampleMinutes 60
if errorlevel 1 (
  echo.
  echo 24-hour autonomous soak did not pass. Review MILES_24H_AUTONOMOUS_SOAK.json for the exact blocker.
  exit /b 2
)

echo.
echo ============================================================
echo MILES FULL GO: 24H_AUTONOMOUS_SOAK_GREEN
echo ============================================================
exit /b 0
