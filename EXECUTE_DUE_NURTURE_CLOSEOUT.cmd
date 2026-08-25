@echo off
setlocal
set "ROOT=C:\P2GC_Intelligence\MILES_ENTERPRISE"
cd /d "%ROOT%"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\SCRIPTS\ExecuteDueNurtureCloseout.ps1" -Root "%ROOT%"
exit /b %ERRORLEVEL%
