@echo off
setlocal
set "ROOT=C:\P2GC_Intelligence\MILES_ENTERPRISE"

if not exist "%ROOT%\.git" (
  echo MILES repository not found: %ROOT%
  exit /b 2
)

cd /d "%ROOT%"

echo ============================================================
echo MILES POST-SOAK REMEDIATION RETRY + LINKEDIN PROSPECT ASSIST
echo ============================================================
echo No new 24-hour soak.
echo No automated LinkedIn connection requests or DMs.
echo No LinkedIn publish.
echo No public B12 publish.
echo.

git fetch origin main || exit /b 2
git checkout main || exit /b 2
git pull --ff-only origin main || exit /b 2

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\SCRIPTS\RunPostSoakRemediationRetry.ps1" -Root "%ROOT%"
set "EC=%ERRORLEVEL%"

echo.
echo ============================================================
if "%EC%"=="0" (
  echo POST_SOAK_REMEDIATION_RETRY_COMPLETE
) else (
  echo POST_SOAK_REMEDIATION_RETRY_STOPPED_WITH_RED
)
echo ============================================================
exit /b %EC%
