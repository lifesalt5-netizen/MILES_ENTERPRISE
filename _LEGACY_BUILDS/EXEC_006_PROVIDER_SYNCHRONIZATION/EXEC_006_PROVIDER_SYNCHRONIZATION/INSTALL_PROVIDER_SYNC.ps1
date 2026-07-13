$ErrorActionPreference = "Stop"

$Root = $env:MILES_ROOT
if ([string]::IsNullOrWhiteSpace($Root)) { $Root = "D:\P2GC_Intelligence\MILES_OS" }
$BuildRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$Backup = Join-Path $Root "BACKUPS\EXEC_006_$Stamp"

Write-Host ""
Write-Host "========================================"
Write-Host " INSTALL EXEC_006 PROVIDER SYNC"
Write-Host "========================================"
Write-Host "Root: $Root"
Write-Host "BuildRoot: $BuildRoot"
Write-Host "Backup: $Backup"

New-Item -ItemType Directory -Force -Path $Backup | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Root "SERVICES") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Root "BUILDER") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Root "DATA\provider_sync") | Out-Null

$ServiceFiles = @(
    "ProviderAuthorityRegistryService.js",
    "ProviderInterfaceAdapterService.js",
    "ProviderCapabilityBindingService.js",
    "ProviderSynchronizationService.js",
    "InstantlyProviderCompatibilityService.js"
)

foreach ($File in $ServiceFiles) {
    $Source = Join-Path $BuildRoot "SERVICES\$File"
    $Dest = Join-Path $Root "SERVICES\$File"
    if (Test-Path $Dest) { Copy-Item $Dest (Join-Path $Backup $File) -Force }
    Copy-Item $Source $Dest -Force
    Write-Host "Installed SERVICES\$File"
}

$BuilderSource = Join-Path $BuildRoot "BUILDER\BuilderService.js"
$BuilderDest = Join-Path $Root "BUILDER\BuilderService.js"
if (Test-Path $BuilderDest) { Copy-Item $BuilderDest (Join-Path $Backup "BuilderService.js") -Force }
Copy-Item $BuilderSource $BuilderDest -Force
Write-Host "Installed BUILDER\BuilderService.js"

Write-Host ""
Write-Host "Running EXEC_006 verification..."
Push-Location $Root
try {
    node .\BUILDER\index.js PROVIDER_SYNC
}
finally {
    Pop-Location
}

Write-Host ""
Write-Host "EXEC_006 install complete."
Write-Host "Run: powershell -ExecutionPolicy Bypass -File .\RUN_PROVIDER_SYNC.ps1"
Write-Host "Verify: powershell -ExecutionPolicy Bypass -File .\VERIFY_PROVIDER_SYNC.ps1"
