param(
    [string]$RepoRoot = "D:\P2GC_Intelligence\MILES_OS"
)

$ErrorActionPreference = "Stop"
Set-Location $RepoRoot

Write-Host "MILES AUTOMATION FASTTRACK STARTING" -ForegroundColor Cyan
node ".\CORE\autonomous_work_engine.js" $RepoRoot
Write-Host ""
node ".\EXECUTIVE\status_report.js" $RepoRoot
Write-Host "MILES AUTOMATION FASTTRACK COMPLETE" -ForegroundColor Green
