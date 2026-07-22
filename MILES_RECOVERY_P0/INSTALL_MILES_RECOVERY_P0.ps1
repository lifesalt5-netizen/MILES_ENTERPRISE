param(
  [string]$MilesRoot = "D:\P2GC_Intelligence\MILES_ENTERPRISE"
)

$ErrorActionPreference = "Stop"

$source = Join-Path $PSScriptRoot "MilesCommandCenter_RECOVERY_P0.js"
$target = Join-Path $MilesRoot "SERVICES\digital_coo\MilesCommandCenter.js"
$runtime = Join-Path $MilesRoot "SERVICES\StartProductionSystem.js"
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backupDir = Join-Path $MilesRoot "BACKUPS\MILES_RECOVERY_P0_$stamp"

if (-not (Test-Path $source)) {
  throw "Replacement file not found: $source"
}

if (-not (Test-Path $target)) {
  throw "Target Command Center file not found: $target"
}

New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
Copy-Item $target (Join-Path $backupDir "MilesCommandCenter.js") -Force

if (Test-Path $runtime) {
  Copy-Item $runtime (Join-Path $backupDir "StartProductionSystem.js") -Force
}

Copy-Item $source $target -Force

if (Test-Path $runtime) {
  $runtimeText = Get-Content $runtime -Raw
  $runtimeText = $runtimeText -replace '(?m)^\s*throw new Error\("BUILD124 HIT"\);\s*\r?\n', ''
  Set-Content -Path $runtime -Value $runtimeText -Encoding UTF8
}

Write-Host ""
Write-Host "Validating JavaScript..." -ForegroundColor Cyan
node --check $target

if (Test-Path $runtime) {
  node --check $runtime
}

Write-Host ""
Write-Host "MILES Recovery P0 installed successfully." -ForegroundColor Green
Write-Host "Backup: $backupDir"
Write-Host ""
Write-Host "Restart MILES with:" -ForegroundColor Yellow
Write-Host 'taskkill /F /IM node.exe'
Write-Host 'node .\StartMilesProduction.js'
