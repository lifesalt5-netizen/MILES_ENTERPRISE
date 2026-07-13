$ErrorActionPreference = "Stop"

$RepoRoot = "D:\P2GC_Intelligence\MILES_OS"
Set-Location $RepoRoot

node ".\BUILDER\index.js" EXECUTIVE_BRAIN "Review P2GC operations and generate the next highest priority autonomous COO action."

Write-Host ""
Write-Host "Executive Brain output:"
Write-Host ".\DATA\executive_brain\latest_executive_decision.json"
Write-Host ".\DATA\executive_brain\executive_brain_report.md"
