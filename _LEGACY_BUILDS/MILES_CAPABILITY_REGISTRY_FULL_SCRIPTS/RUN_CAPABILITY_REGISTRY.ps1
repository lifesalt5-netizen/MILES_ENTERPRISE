$ErrorActionPreference = "Stop"

$RepoRoot = "D:\P2GC_Intelligence\MILES_OS"

Set-Location $RepoRoot

node ".\BUILDER\index.js" CAPABILITY_REGISTRY

Write-Host ""
Write-Host "Capability output:"
Write-Host ".\DATA\capability\capability_registry.json"
Write-Host ".\DATA\capability\capability_report.md"
