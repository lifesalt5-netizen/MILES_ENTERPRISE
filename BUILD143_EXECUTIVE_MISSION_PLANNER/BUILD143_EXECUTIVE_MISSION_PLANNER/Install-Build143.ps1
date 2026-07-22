param(
  [string]$MilesRoot = "D:\P2GC_Intelligence\MILES_ENTERPRISE"
)
$ErrorActionPreference = "Stop"
$BuildRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Target = Join-Path $MilesRoot "SERVICES\CommandIntentPlannerService.js"
$Timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$BackupDir = Join-Path $MilesRoot "BACKUPS\BUILD143_$Timestamp"
$Backup = Join-Path $BackupDir "CommandIntentPlannerService.js"
try {
  Write-Host "[BUILD143] Executive Mission Planner" -ForegroundColor Cyan
  if (-not (Test-Path $Target)) { throw "Planner not found: $Target" }
  New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
  Copy-Item $Target $Backup -Force
  Write-Host "[BUILD143] Backup: $BackupDir"
  node (Join-Path $BuildRoot "ApplyBuild143.js") $MilesRoot
  node --check $Target
  if ($LASTEXITCODE -ne 0) { throw "Node syntax validation failed." }
  node (Join-Path $BuildRoot "TestBuild143.js") $MilesRoot
  if ($LASTEXITCODE -ne 0) { throw "Build143 tests failed." }
  Write-Host "[BUILD143] STATUS: PASSED" -ForegroundColor Green
  Write-Host "Restart MILES, then rerun the executive revenue command." -ForegroundColor Green
} catch {
  Write-Host "[BUILD143] FAILED: $($_.Exception.Message)" -ForegroundColor Red
  if (Test-Path $Backup) {
    Copy-Item $Backup $Target -Force
    Write-Host "[BUILD143] Rollback completed." -ForegroundColor Yellow
  }
  exit 1
}
