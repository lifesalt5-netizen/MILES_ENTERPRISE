$ErrorActionPreference = "Stop"

$RepoRoot = "D:\P2GC_Intelligence\MILES_OS"
Set-Location $RepoRoot

node ".\BUILDER\index.js" COMPANY_STATE

Write-Host ""
Write-Host "Company State output:"
Write-Host ".\DATA\company_state\company_state.json"
Write-Host ".\DATA\company_state\company_state_report.md"
