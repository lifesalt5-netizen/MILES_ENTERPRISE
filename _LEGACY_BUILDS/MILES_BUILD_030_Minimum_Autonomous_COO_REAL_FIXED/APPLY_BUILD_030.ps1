$ErrorActionPreference = "Stop"

$TargetRoot = "D:\P2GC_Intelligence\MILES_OS"
$PatchRoot = Join-Path $PSScriptRoot "MILES_OS"
$BackupRoot = Join-Path $TargetRoot ("BACKUPS\BUILD_030_" + (Get-Date -Format "yyyyMMdd_HHmmss"))

Write-Host "========================================" -ForegroundColor Cyan
Write-Host " APPLYING MILES BUILD 030" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Patch:  $PatchRoot"
Write-Host "Target: $TargetRoot"
Write-Host "Backup: $BackupRoot"

if (!(Test-Path $PatchRoot)) { throw "Patch folder not found: $PatchRoot" }
if (!(Test-Path $TargetRoot)) { throw "Target MILES_OS not found: $TargetRoot" }

$Files = @(
    "SERVICES\Browser\Workers\InstantlyCampaignOperator.js",
    "TESTS\Test_Build030_MinimumAutonomousCOO.js",
    "START_MILES_BUILD_030.ps1"
)

foreach ($rel in $Files) {
    $src = Join-Path $PatchRoot $rel
    $dst = Join-Path $TargetRoot $rel
    $bak = Join-Path $BackupRoot $rel

    if (!(Test-Path $src)) { throw "Patch file missing: $src" }

    if (Test-Path $dst) {
        New-Item -ItemType Directory -Path (Split-Path $bak) -Force | Out-Null
        Copy-Item $dst $bak -Force
    }

    New-Item -ItemType Directory -Path (Split-Path $dst) -Force | Out-Null
    Copy-Item $src $dst -Force
    Write-Host "Updated: $rel" -ForegroundColor Green
}

Write-Host ""
Write-Host "Build 030 applied." -ForegroundColor Green
Write-Host "Run:" -ForegroundColor Yellow
Write-Host "cd D:\P2GC_Intelligence\MILES_OS"
Write-Host "node .\TESTS\Test_Build030_MinimumAutonomousCOO.js --show"
Write-Host ".\START_MILES_BUILD_030.ps1 -Once -Execute -Show"
