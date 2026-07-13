@echo off
title Install MILES Enterprise Registry
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0INSTALL_MILES_ENTERPRISE_REGISTRY.ps1"
echo.
pause
