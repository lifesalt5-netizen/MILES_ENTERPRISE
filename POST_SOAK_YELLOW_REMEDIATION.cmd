@echo off
setlocal

set "ROOT=C:\P2GC_Intelligence\MILES_ENTERPRISE"

if not exist "%ROOT%\.git" (
  echo MILES repository not found: %ROOT%
  exit /b 2
)

cd /d "%ROOT%"

echo ============================================================
echo MILES POST-SOAK YELLOW REMEDIATION
echo ============================================================
echo This does NOT start another 24-hour soak.
echo It does NOT publish B12 publicly.
echo It does NOT publish LinkedIn.
echo It does NOT mutate Instantly unless a precheck proves zero eligible actions.
echo.

git fetch origin main || exit /b 2
git checkout main || exit /b 2
git pull --ff-only origin main || exit /b 2

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\SCRIPTS\RunPostSoakYellowRemediation.ps1" -Root "%ROOT%"
set "EC=%ERRORLEVEL%"

echo.
echo ============================================================
if "%EC%"=="0" (
  echo POST_SOAK_YELLOW_REMEDIATION_COMPLETE
) else (
  echo POST_SOAK_YELLOW_REMEDIATION_STOPPED_WITH_RED
)
echo ============================================================
exit /b %EC%
