# MILES Sprint Zero Runner
# Run from your MILES repo root, for example:
# cd D:\P2GC_Intelligence\MILES_OS
# .\run-sprint-zero.ps1

$ErrorActionPreference = "Stop"

Write-Host "MILES Sprint Zero Discovery starting..." -ForegroundColor Cyan

if (!(Test-Path ".\tools")) {
    New-Item -ItemType Directory -Path ".\tools" | Out-Null
}

if (!(Test-Path ".\tools\sprint-zero-discovery.js")) {
    Write-Host "Missing tools\sprint-zero-discovery.js" -ForegroundColor Yellow
    Write-Host "Copy sprint-zero-discovery.js into .\tools first." -ForegroundColor Yellow
    exit 1
}

node .\tools\sprint-zero-discovery.js

Write-Host "Sprint Zero complete. Check .\sprint_zero_output" -ForegroundColor Green
