$ErrorActionPreference = "Stop"

$RepoRoot = "D:\P2GC_Intelligence\MILES_OS"
$PackageRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackupRoot = Join-Path $RepoRoot "BACKUPS\installer_backups"
$Stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$BackupDir = Join-Path $BackupRoot "build_033_executive_brain_$Stamp"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " BUILD_033 Executive Brain Installer" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

if (!(Test-Path $RepoRoot)) {
    Write-Host "Repository root not found: $RepoRoot" -ForegroundColor Red
    exit 1
}

New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $RepoRoot "SERVICES") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $RepoRoot "DATA\executive_brain") | Out-Null

$Files = @(
    @{
        Source = Join-Path $PackageRoot "SERVICES\ExecutiveBrainService.js"
        Target = Join-Path $RepoRoot "SERVICES\ExecutiveBrainService.js"
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
Write-Host "Running Executive Brain verification..." -ForegroundColor Cyan

node ".\BUILDER\index.js" EXECUTIVE_BRAIN "Build next operating priority for P2GC using repository and capability awareness."

if ($LASTEXITCODE -ne 0) {
    Write-Host "Executive Brain verification failed." -ForegroundColor Red
    Write-Host "Backups are here: $BackupDir" -ForegroundColor Yellow
    exit $LASTEXITCODE
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host " BUILD_033 Executive Brain Installed" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host "Output:"
Write-Host "D:\P2GC_Intelligence\MILES_OS\DATA\executive_brain"
Write-Host ""
