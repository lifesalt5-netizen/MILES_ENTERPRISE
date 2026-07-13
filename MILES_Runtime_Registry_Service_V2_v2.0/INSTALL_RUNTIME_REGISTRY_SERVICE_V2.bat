@echo off
title Install MILES Runtime Registry Service V2
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0INSTALL_RUNTIME_REGISTRY_SERVICE_V2.ps1"
echo.
pause
