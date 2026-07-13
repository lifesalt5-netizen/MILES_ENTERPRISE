# MILES Capability Registry Installer
# Version: 1.0.0

$ErrorActionPreference = "Stop"

$RepoRoot = "D:\P2GC_Intelligence\MILES_OS"
$PackageRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackupRoot = Join-Path $RepoRoot "BACKUPS\installer_backups"
$Stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$BackupDir = Join-Path $BackupRoot "capability_registry_$Stamp"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " MILES Capability Registry Installer" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

if (!(Test-Path $RepoRoot)) {
    Write-Host "Repository root not found: $RepoRoot" -ForegroundColor Red
    exit 1
}

New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $RepoRoot "SERVICES") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $RepoRoot "DATA\capability") | Out-Null

$Files = @(
    @{
        Source = Join-Path $PackageRoot "SERVICES\CapabilityRegistryService.js"
        Target = Join-Path $RepoRoot "SERVICES\CapabilityRegistryService.js"
    },
    @{
        Source = Join-Path $PackageRoot "BUILDER\BuilderService.js"
        Target = Join-Path $RepoRoot "BUILDER\BuilderService.js"
    }
)

foreach ($File in $Files) {
    if (!(Test-Path $File.Source)) {
        Write-Host "Missing package file: $($File.Source)" -ForegroundColor Red
        exit 1
    }

    if (Test-Path $File.Target) {
        $BackupTarget = Join-Path $BackupDir ((Split-Path $File.Target -Leaf) + ".bak")
        Copy-Item $File.Target $BackupTarget -Force
        Write-Host "Backed up: $($File.Target)" -ForegroundColor Yellow
    }

    Copy-Item $File.Source $File.Target -Force
    Write-Host "Installed: $($File.Target)" -ForegroundColor Green
}

Set-Location $RepoRoot

Write-Host ""
Write-Host "Running Repository Registry first..." -ForegroundColor Cyan
node ".\BUILDER\index.js" REPOSITORY_REGISTRY

if ($LASTEXITCODE -ne 0) {
    Write-Host "Repository Registry failed." -ForegroundColor Red
    exit $LASTEXITCODE
}

Write-Host ""
Write-Host "Running Capability Registry verification..." -ForegroundColor Cyan
node ".\BUILDER\index.js" CAPABILITY_REGISTRY

if ($LASTEXITCODE -ne 0) {
    Write-Host "Capability Registry verification failed." -ForegroundColor Red
    Write-Host "Backups are here: $BackupDir" -ForegroundColor Yellow
    exit $LASTEXITCODE
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host " Capability Registry Installed" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host "Output:" -ForegroundColor Green
Write-Host "D:\P2GC_Intelligence\MILES_OS\DATA\capability"
Write-Host ""
