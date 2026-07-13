$ErrorActionPreference = "Stop"
$Root = "D:\P2GC_Intelligence\MILES_OS"
$BuildRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$Backup = Join-Path $Root "BACKUPS\EXEC_003_$Stamp"
Write-Host ""
Write-Host "========================================"
Write-Host " INSTALL EXEC_003 INSTANTLY LIVE"
Write-Host "========================================"
Write-Host "Root: $Root"
Write-Host "BuildRoot: $BuildRoot"
Write-Host "Backup: $Backup"
New-Item -ItemType Directory -Force -Path $Backup | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Root "SERVICES") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Root "BUILDER") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Root "DATA\instantly_live") | Out-Null
$files = @(
  "SERVICES\InstantlyApiClient.js",
  "SERVICES\InstantlyLiveProviderController.js",
  "SERVICES\InstantlyActionBridgeService.js",
  "SERVICES\InstantlyLiveIntegrationService.js",
  "BUILDER\BuilderService.js"
)
foreach ($f in $files) {
  $src = Join-Path $BuildRoot $f
  $dst = Join-Path $Root $f
  if (Test-Path $dst) {
    $backupDst = Join-Path $Backup $f
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $backupDst) | Out-Null
    Copy-Item $dst $backupDst -Force
  }
  Copy-Item $src $dst -Force
  Write-Host "Installed $f"
}
Copy-Item (Join-Path $BuildRoot "RUNNERS\*.ps1") $Root -Force
Copy-Item (Join-Path $BuildRoot "VERIFY\*.ps1") $Root -Force
Write-Host ""
Write-Host "Running EXEC_003 verification..."
Set-Location $Root
powershell -ExecutionPolicy Bypass -File .\VERIFY_EXEC_003.ps1
Write-Host ""
Write-Host "EXEC_003 install complete."
Write-Host "Run health: powershell -ExecutionPolicy Bypass -File .\RUN_INSTANTLY_HEALTH.ps1"
Write-Host "Run live: powershell -ExecutionPolicy Bypass -File .\RUN_INSTANTLY_LIVE.ps1"
Write-Host "Run bridge: powershell -ExecutionPolicy Bypass -File .\RUN_INSTANTLY_BRIDGE_ACTION.ps1"
