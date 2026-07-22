param([string]$Root = "")
$ErrorActionPreference = "Stop"
$Build = "BUILD132"
$Stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$Package = Split-Path -Parent $MyInvocation.MyCommand.Path

function Find-MilesRoot([string]$StartPath) {
  $Current = (Resolve-Path $StartPath).Path
  for ($i = 0; $i -lt 8; $i++) {
    if ((Test-Path (Join-Path $Current "SERVICES\ProviderRegistry.js")) -and (Test-Path (Join-Path $Current "PROVIDERS\providers\InstantlyProvider.js")) -and (Test-Path (Join-Path $Current "CONNECTORS\INSTANTLY\instantly.js"))) { return $Current }
    $Parent = Split-Path -Parent $Current
    if ([string]::IsNullOrWhiteSpace($Parent) -or $Parent -eq $Current) { break }
    $Current = $Parent
  }
  throw "MILES_ENTERPRISE root not found. Use -Root D:\P2GC_Intelligence\MILES_ENTERPRISE"
}
function Require-File([string]$Path) { if (!(Test-Path $Path)) { throw "Required file missing: $Path" } }
function Backup-File([string]$Relative) {
  $Source = Join-Path $Root $Relative
  if (Test-Path $Source) {
    $Target = Join-Path $Backup $Relative
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Target) | Out-Null
    Copy-Item $Source $Target -Force
    Write-Host "[BACKUP] $Relative"
  }
}
if ([string]::IsNullOrWhiteSpace($Root)) { $Root = Find-MilesRoot $Package }
$Root = (Resolve-Path $Root).Path
$Backup = Join-Path $Root ("BACKUPS\" + $Build + "_" + $Stamp)
$Rollback = Join-Path $Package ("Rollback\rollback_" + $Stamp + ".ps1")
Write-Host "============================================================"
Write-Host " BUILD 132 - INSTANTLY ENTERPRISE ADAPTER"
Write-Host "============================================================"
Write-Host "ROOT: $Root"
Require-File (Join-Path $Root "SERVICES\ProviderRegistry.js")
Require-File (Join-Path $Root "PROVIDERS\providers\InstantlyProvider.js")
Require-File (Join-Path $Root "CONNECTORS\INSTANTLY\instantly.js")
Require-File (Join-Path $Package "Files\SERVICES\InstantlyEnterpriseAdapterService.js")
Require-File (Join-Path $Package "Patch.js")
Require-File (Join-Path $Package "Tests\Build132.test.js")
New-Item -ItemType Directory -Force -Path $Backup | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Rollback) | Out-Null
Backup-File "SERVICES\ProviderRegistry.js"
Backup-File "SERVICES\InstantlyEnterpriseAdapterService.js"
try {
  Copy-Item (Join-Path $Package "Files\SERVICES\InstantlyEnterpriseAdapterService.js") (Join-Path $Root "SERVICES\InstantlyEnterpriseAdapterService.js") -Force
  & node (Join-Path $Package "Patch.js") $Root
  if ($LASTEXITCODE -ne 0) { throw "Patch.js failed." }
  $Checks = @("SERVICES\ProviderRegistry.js","SERVICES\InstantlyEnterpriseAdapterService.js","PROVIDERS\providers\InstantlyProvider.js","CONNECTORS\INSTANTLY\instantly.js")
  foreach ($Relative in $Checks) {
    Write-Host "[CHECK] $Relative"
    & node --check (Join-Path $Root $Relative)
    if ($LASTEXITCODE -ne 0) { throw "Syntax validation failed: $Relative" }
  }
  & node (Join-Path $Package "Tests\Build132.test.js") $Root
  if ($LASTEXITCODE -ne 0) { throw "Build 132 tests failed." }
  $RollbackLines = @(
    'param()',$ErrorActionPreference,
    ('Copy-Item -Force "' + (Join-Path $Backup 'SERVICES\ProviderRegistry.js') + '" "' + (Join-Path $Root 'SERVICES\ProviderRegistry.js') + '"'),
    ('if (Test-Path "' + (Join-Path $Backup 'SERVICES\InstantlyEnterpriseAdapterService.js') + '") { Copy-Item -Force "' + (Join-Path $Backup 'SERVICES\InstantlyEnterpriseAdapterService.js') + '" "' + (Join-Path $Root 'SERVICES\InstantlyEnterpriseAdapterService.js') + '" } else { Remove-Item -Force -ErrorAction SilentlyContinue "' + (Join-Path $Root 'SERVICES\InstantlyEnterpriseAdapterService.js') + '" }'),
    'Write-Host "BUILD 132 ROLLBACK COMPLETE"'
  )
  [System.IO.File]::WriteAllLines($Rollback,$RollbackLines,[System.Text.Encoding]::ASCII)
  Write-Host "============================================================"
  Write-Host " BUILD 132 COMPLETE"
  Write-Host "============================================================"
  Write-Host "STATUS: PASSED"
  Write-Host "BACKUP: $Backup"
  Write-Host "ROLLBACK: $Rollback"
  Write-Host "NEXT: BUILD 133"
} catch {
  Write-Host "BUILD 132 FAILED - AUTOMATIC ROLLBACK" -ForegroundColor Red
  $SavedRegistry = Join-Path $Backup "SERVICES\ProviderRegistry.js"
  if (Test-Path $SavedRegistry) { Copy-Item $SavedRegistry (Join-Path $Root "SERVICES\ProviderRegistry.js") -Force }
  $SavedAdapter = Join-Path $Backup "SERVICES\InstantlyEnterpriseAdapterService.js"
  $TargetAdapter = Join-Path $Root "SERVICES\InstantlyEnterpriseAdapterService.js"
  if (Test-Path $SavedAdapter) { Copy-Item $SavedAdapter $TargetAdapter -Force } elseif (Test-Path $TargetAdapter) { Remove-Item $TargetAdapter -Force }
  throw
}
