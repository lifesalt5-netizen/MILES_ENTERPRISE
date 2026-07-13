$ErrorActionPreference = "Stop"

$RepoRoot = "D:\P2GC_Intelligence\MILES_OS"
Set-Location $RepoRoot

node ".\BUILDER\index.js" TASK_ROUTER

Write-Host ""
Write-Host "Task Router output:"
Write-Host ".\DATA\task_router\latest_task_router_run.json"
Write-Host ".\DATA\task_router\task_router_report.md"
