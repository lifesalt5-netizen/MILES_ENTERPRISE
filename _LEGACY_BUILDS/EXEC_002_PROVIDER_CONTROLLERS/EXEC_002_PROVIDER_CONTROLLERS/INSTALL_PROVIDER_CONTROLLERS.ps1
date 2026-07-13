$ErrorActionPreference = "Stop"
$Root = $env:MILES_ROOT
if ([string]::IsNullOrWhiteSpace($Root)) { $Root = "D:\P2GC_Intelligence\MILES_OS" }
$BuildRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$Backup = Join-Path $Root "BACKUPS\EXEC_002_$Stamp"

Write-Host ""
Write-Host "========================================"
Write-Host " INSTALL EXEC_002 PROVIDER CONTROLLERS"
Write-Host "========================================"
Write-Host "Root: $Root"
Write-Host "BuildRoot: $BuildRoot"
Write-Host "Backup: $Backup"

New-Item -ItemType Directory -Force -Path $Backup | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Root "SERVICES") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Root "BUILDER") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Root "DATA\provider_controllers") | Out-Null

$serviceFiles = Get-ChildItem -Path (Join-Path $BuildRoot "SERVICES") -Filter "*.js"
foreach ($file in $serviceFiles) {
    $dest = Join-Path $Root "SERVICES\$($file.Name)"
    if (Test-Path $dest) { Copy-Item $dest (Join-Path $Backup $file.Name) -Force }
    Copy-Item $file.FullName $dest -Force
    Write-Host "Installed SERVICES\$($file.Name)"
}

$builderDest = Join-Path $Root "BUILDER\BuilderService.js"
if (Test-Path $builderDest) { Copy-Item $builderDest (Join-Path $Root "BUILDER\BuilderService.previous.js") -Force; Copy-Item $builderDest (Join-Path $Backup "BuilderService.js") -Force }
Copy-Item (Join-Path $BuildRoot "BUILDER\BuilderService.js") $builderDest -Force
Write-Host "Installed BUILDER\BuilderService.js"

Write-Host ""
Write-Host "Running EXEC_002 verification..."
Push-Location $Root
node .\BUILDER\index.js EXEC_002_VERIFY
Pop-Location
Write-Host ""
Write-Host "EXEC_002 install complete."
