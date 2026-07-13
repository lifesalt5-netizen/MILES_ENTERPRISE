param(
    [string]$Root = "D:\P2GC_Intelligence\MILES_OS"
)

$ErrorActionPreference = "Stop"
$BuildRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$BackupRoot = Join-Path $Root "BACKUPS\BUILD_037_$Timestamp"

Write-Host ""
Write-Host "========================================"
Write-Host " INSTALL BUILD_037 EXECUTIVE DASHBOARD"
Write-Host "========================================"
Write-Host "Root: $Root"
Write-Host "BuildRoot: $BuildRoot"
Write-Host "Backup: $BackupRoot"

if (!(Test-Path $Root)) {
    throw "MILES root does not exist: $Root"
}

New-Item -ItemType Directory -Force -Path $BackupRoot | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Root "SERVICES") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Root "BUILDER") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Root "DATA\executive_dashboard") | Out-Null

$Files = @(
    @{ Source = "SERVICES\DashboardDataService.js"; Target = "SERVICES\DashboardDataService.js" },
    @{ Source = "SERVICES\ExecutiveDashboardService.js"; Target = "SERVICES\ExecutiveDashboardService.js" },
    @{ Source = "SERVICES\DashboardServerService.js"; Target = "SERVICES\DashboardServerService.js" },
    @{ Source = "BUILDER\BuilderService.js"; Target = "BUILDER\BuilderService.js" }
)

foreach ($File in $Files) {
    $Source = Join-Path $BuildRoot $File.Source
    $Target = Join-Path $Root $File.Target
    $Backup = Join-Path $BackupRoot $File.Target
    $BackupDir = Split-Path -Parent $Backup

    if (!(Test-Path $Source)) {
        throw "Missing build file: $Source"
    }

    New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null

    if (Test-Path $Target) {
        Copy-Item -Force $Target $Backup
    }

    Copy-Item -Force $Source $Target
    Write-Host "Installed $($File.Target)"
}

Write-Host ""
Write-Host "Running BUILD_037 verification..."
Push-Location $Root
try {
    node .\BUILDER\index.js EXECUTIVE_DASHBOARD | Tee-Object -FilePath (Join-Path $Root "DATA\executive_dashboard\install_verification_output.json")
}
finally {
    Pop-Location
}

Write-Host ""
Write-Host "BUILD_037 install complete."
Write-Host "Run dashboard once: powershell -ExecutionPolicy Bypass -File .\RUN_EXECUTIVE_DASHBOARD.ps1"
Write-Host "Run server: powershell -ExecutionPolicy Bypass -File .\RUN_EXECUTIVE_DASHBOARD_SERVER.ps1"
