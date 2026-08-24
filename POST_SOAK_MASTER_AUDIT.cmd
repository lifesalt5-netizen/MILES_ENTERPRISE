@echo off
setlocal
cd /d C:\P2GC_Intelligence\MILES_ENTERPRISE

echo ============================================================
echo MILES POST-SOAK MASTER AUDIT
echo ============================================================
echo This audit is read-only against external providers.
echo It does NOT start another 24-hour soak.
echo It does NOT activate campaigns, publish B12, or publish LinkedIn.
echo.

git fetch origin main
if errorlevel 1 goto :fail

git checkout main
if errorlevel 1 goto :fail

git pull --ff-only origin main
if errorlevel 1 goto :fail

powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\SCRIPTS\RunPostSoakMasterAudit.ps1 -Root "C:\P2GC_Intelligence\MILES_ENTERPRISE"
if errorlevel 1 goto :fail

echo.
echo ============================================================
echo POST_SOAK_MASTER_AUDIT_COMPLETE
echo ============================================================
exit /b 0

:fail
echo.
echo ============================================================
echo POST_SOAK_MASTER_AUDIT_BLOCKED
echo ============================================================
exit /b 2
