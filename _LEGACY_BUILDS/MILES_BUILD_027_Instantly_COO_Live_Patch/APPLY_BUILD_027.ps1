$ErrorActionPreference = "Stop"

$TargetRoot = "D:\P2GC_Intelligence\MILES_OS"
$PatchRoot = Join-Path $PSScriptRoot "MILES_OS"
$Stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$BackupRoot = "D:\P2GC_Intelligence\MILES_OS_BACKUP_BUILD_027_$Stamp"

Write-Host "MILES BUILD 027 - Instantly COO live patch" -ForegroundColor Cyan
Write-Host "Target: $TargetRoot"
Write-Host "Patch:  $PatchRoot"
Write-Host "Backup: $BackupRoot"

if (!(Test-Path $TargetRoot)) { throw "Target root not found: $TargetRoot" }
if (!(Test-Path $PatchRoot)) { throw "Patch root not found: $PatchRoot" }

New-Item -ItemType Directory -Path $BackupRoot -Force | Out-Null

$Files = @(
  "SERVICES\Browser\Workers\InstantlyCampaignOperator.js",
  "TESTS\Test_InstantlyCampaignOperator.js"
)

foreach ($Rel in $Files) {
  $Source = Join-Path $PatchRoot $Rel
  $Dest = Join-Path $TargetRoot $Rel
  $Backup = Join-Path $BackupRoot $Rel

  if (!(Test-Path $Source)) { throw "Patch file missing: $Source" }

  New-Item -ItemType Directory -Path (Split-Path $Backup) -Force | Out-Null
  New-Item -ItemType Directory -Path (Split-Path $Dest) -Force | Out-Null

  if (Test-Path $Dest) {
    Copy-Item $Dest $Backup -Force
  }

  Copy-Item $Source $Dest -Force
  Write-Host "Updated $Rel" -ForegroundColor Green
}

Write-Host "\nBuild 027 applied." -ForegroundColor Green
Write-Host "Next test:"
Write-Host "cd D:\P2GC_Intelligence\MILES_OS"
Write-Host "node .\TESTS\Test_InstantlyCampaignOperator.js"
Write-Host "Safe execute audit:"
Write-Host "node .\TESTS\Test_InstantlyCampaignOperator.js --execute"
