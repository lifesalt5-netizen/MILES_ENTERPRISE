@echo off
setlocal
set "ROOT=C:\P2GC_Intelligence\MILES_ENTERPRISE"

rem The live Federal Pathway Score runner requires a real company name or UEI.
rem Allow an operator-supplied target, otherwise use the current evidence-backed acceptance client.
if not defined P2GC_PATHWAY_SCORE_TERM set "P2GC_PATHWAY_SCORE_TERM=Sera Brynn LLC"

if not exist "%ROOT%\.git" (
  echo ERROR: MILES production checkout not found at %ROOT%
  exit /b 2
)

cd /d "%ROOT%" || exit /b 2

echo ============================================================
echo MILES PRE-FINAL-SOAK RELEASE CANDIDATE
echo ============================================================
echo Updating local checkout to current main...

git fetch origin main
if errorlevel 1 exit /b 2

git checkout main
if errorlevel 1 exit /b 2

git pull --ff-only origin main
if errorlevel 1 exit /b 2

echo.
echo Running comprehensive pre-final-soak validation.
echo Federal Pathway Score live target: %P2GC_PATHWAY_SCORE_TERM%
echo This command may repair only the governed Instantly weekday schedules.
echo It will not activate acquisition campaigns, publish B12, publish LinkedIn, or start the soak.
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "SCRIPTS\RunPreFinalSoakReadiness.ps1" -Root "%ROOT%" -ExecuteInstantlyWeekdayRepair
if errorlevel 1 (
  echo.
  echo PRE-FINAL-SOAK RELEASE CANDIDATE BLOCKED.
  echo Review DATA\operational_acceptance\pre_final_soak\PRE_FINAL_SOAK_READINESS_LATEST.json
  exit /b 2
)

echo.
echo ============================================================
echo PRE_FINAL_SOAK_RELEASE_CANDIDATE_GREEN
echo ============================================================
echo Send the terminal output to MILES for evidence review before running FINAL_GO_LIVE.cmd.
exit /b 0
