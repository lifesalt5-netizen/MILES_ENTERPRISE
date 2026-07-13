$ErrorActionPreference = "Stop"

$RepoRoot = "D:\P2GC_Intelligence\MILES_OS"
$PackageRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackupRoot = Join-Path $RepoRoot "BACKUPS\installer_backups"
$Stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$BackupDir = Join-Path $BackupRoot "build_035_task_router_$Stamp"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " BUILD_035 Task Router Installer" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

if (!(Test-Path $RepoRoot)) {
    Write-Host "Repository root not found: $RepoRoot" -ForegroundColor Red
    exit 1
}

New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $RepoRoot "SERVICES") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $RepoRoot "DATA\task_router") | Out-Null

$Files = @(
    @{
        Source = Join-Path $PackageRoot "SERVICES\TaskRouterService.js"
        Target = Join-Path $RepoRoot "SERVICES\TaskRouterService.js"
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
Write-Host "Running Task Router verification..." -ForegroundColor Cyan

node ".\BUILDER\index.js" TASK_ROUTER

if ($LASTEXITCODE -ne 0) {
    Write-Host "Task Router verification failed." -ForegroundColor Red
    Write-Host "Backups are here: $BackupDir" -ForegroundColor Yellow
    exit $LASTEXITCODE
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host " BUILD_035 Task Router Installed" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host "Output:"
Write-Host "D:\P2GC_Intelligence\MILES_OS\DATA\task_router"
Write-Host ""
