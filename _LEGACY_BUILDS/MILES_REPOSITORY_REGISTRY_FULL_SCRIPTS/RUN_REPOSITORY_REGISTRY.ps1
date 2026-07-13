$ErrorActionPreference = "Stop"

$RepoRoot = "D:\P2GC_Intelligence\MILES_OS"

Set-Location $RepoRoot

node ".\BUILDER\index.js" REPOSITORY_REGISTRY

Write-Host ""
Write-Host "Registry output:"
Write-Host ".\DATA\repository\repository_registry.json"
Write-Host ".\DATA\repository\inventory_report.md"
