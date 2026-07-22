param([string]$Root = (Get-Location).Path)
$ErrorActionPreference = "Stop"
$Build = "BUILD132"
$Stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$Package = Split-Path -Parent $MyInvocation.MyCommand.Path
$Backup = Join-Path $Root "BACKUPS\${Build}_$Stamp"
$Rollback = Join-Path $Package "Rollback\rollback_$Stamp.ps1"

function Require-File([string]$Path) { if (!(Test-Path $Path)) { throw "Required file missing: $Path" } }
function Copy-Backup([string]$Relative) {
  $Source = Join-Path $Root $Relative
  if (Test-Path $Source) {
    $Target = Join-Path $Backup $Relative
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Target) | Out-Null
    Copy-Item $Source $Target -Force
  }
}

Require-File (Join-Path $Root "SERVICES\ProviderRegistry.js")
Require-File (Join-Path $Root "PROVIDERS\providers\InstantlyProvider.js")
Require-File (Join-Path $Root "CONNECTORS\INSTANTLY\instantly.js")
Require-File (Join-Path $Package "Files\SERVICES\InstantlyEnterpriseAdapterService.js")
Require-File (Join-Path $Package "Patch.js")
Require-File (Join-Path $Package "Tests\Build132.test.js")

New-Item -ItemType Directory -Force -Path $Backup | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Rollback) | Out-Null
Copy-Backup "SERVICES\ProviderRegistry.js"
Copy-Backup "SERVICES\InstantlyEnterpriseAdapterService.js"

try {
  Copy-Item (Join-Path $Package "Files\SERVICES\InstantlyEnterpriseAdapterService.js") (Join-Path $Root "SERVICES\InstantlyEnterpriseAdapterService.js") -Force
  node (Join-Path $Package "Patch.js") $Root
  if ($LASTEXITCODE -ne 0) { throw "Patch.js failed." }

  $Checks = @(
    "SERVICES\InstantlyEnterpriseAdapterService.js",
    "SERVICES\ProviderRegistry.js",
    "PROVIDERS\providers\InstantlyProvider.js",
    "CONNECTORS\INSTANTLY\instantly.js"
  )
  foreach ($Relative in $Checks) {
    node --check (Join-Path $Root $Relative)
    if ($LASTEXITCODE -ne 0) { throw "Syntax validation failed: $Relative" }
  }

  node (Join-Path $Package "Tests\Build132.test.js") $Root
  if ($LASTEXITCODE -ne 0) { throw "Build 132 tests failed." }

  @"
`$ErrorActionPreference = 'Stop'
`$Root = '$($Root.Replace("'","''"))'
`$Backup = '$($Backup.Replace("'","''"))'
`$Files = @('SERVICES\ProviderRegistry.js','SERVICES\InstantlyEnterpriseAdapterService.js')
foreach (`$Relative in `$Files) {
  `$Saved = Join-Path `$Backup `$Relative
  `$Target = Join-Path `$Root `$Relative
  if (Test-Path `$Saved) { New-Item -ItemType Directory -Force -Path (Split-Path -Parent `$Target) | Out-Null; Copy-Item `$Saved `$Target -Force }
  elseif (`$Relative -eq 'SERVICES\InstantlyEnterpriseAdapterService.js' -and (Test-Path `$Target)) { Remove-Item `$Target -Force }
}
Write-Host 'BUILD 132 ROLLBACK COMPLETE'
"@ | Set-Content -Path $Rollback -Encoding UTF8

  Write-Host "============================================================"
  Write-Host "BUILD 132 COMPLETE"
  Write-Host "============================================================"
  Write-Host "STATUS: PASSED"
  Write-Host "BACKUP: $Backup"
  Write-Host "ROLLBACK: $Rollback"
  Write-Host "NEXT: BUILD 133"
}
catch {
  Write-Host "BUILD 132 FAILED — AUTOMATIC ROLLBACK" -ForegroundColor Red
  $RegistryBackup = Join-Path $Backup "SERVICES\ProviderRegistry.js"
  if (Test-Path $RegistryBackup) { Copy-Item $RegistryBackup (Join-Path $Root "SERVICES\ProviderRegistry.js") -Force }
  $AdapterBackup = Join-Path $Backup "SERVICES\InstantlyEnterpriseAdapterService.js"
  $AdapterTarget = Join-Path $Root "SERVICES\InstantlyEnterpriseAdapterService.js"
  if (Test-Path $AdapterBackup) { Copy-Item $AdapterBackup $AdapterTarget -Force }
  elseif (Test-Path $AdapterTarget) { Remove-Item $AdapterTarget -Force }
  throw
}
