@echo off
title MILES Registry Convergence Inspector
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0RUN_REGISTRY_CONVERGENCE_INSPECTOR.ps1"
