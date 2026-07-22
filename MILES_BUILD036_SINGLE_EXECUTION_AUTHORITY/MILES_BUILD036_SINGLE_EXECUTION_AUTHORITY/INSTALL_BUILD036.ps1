param(
    [string]$MilesRoot = "D:\P2GC_Intelligence\MILES_ENTERPRISE"
)

$ErrorActionPreference = "Stop"
$PackageRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$BackupRoot = Join-Path $MilesRoot "_BACKUPS\BUILD_036_$Stamp"

Write-Host ""
Write-Host "MILES ENTERPRISE BUILD 036 INSTALLER"
Write-Host "Root: $MilesRoot"
Write-Host "Backup: $BackupRoot"
Write-Host ""

Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force

$Files = @(
    "CORE\TaskQueue.js",
    "SERVICES\ExecutionService.js",
    "StartProductionSystem.js",
    "SERVICES\AutonomousCOOLoopService.js",
    "SERVICES\COOOrchestratorService.js",
    "SERVICES\SchedulerService.js",
    "SERVICES\StartProductionSystem.js",
    "TESTS\Test_Build036_SingleExecutionAuthority.js"
)

foreach ($RelativePath in $Files) {
    $Source = Join-Path $PackageRoot $RelativePath
    $Target = Join-Path $MilesRoot $RelativePath
    $Backup = Join-Path $BackupRoot $RelativePath

    if (-not (Test-Path $Source)) {
        throw "Missing package file: $Source"
    }

    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Target) | Out-Null
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Backup) | Out-Null

    if (Test-Path $Target) {
        Copy-Item $Target $Backup -Force
    }

    Copy-Item $Source $Target -Force
    Write-Host "Installed: $RelativePath"
}

Push-Location $MilesRoot

$Checks = @(
    ".\CORE\TaskQueue.js",
    ".\SERVICES\ExecutionService.js",
    ".\StartProductionSystem.js",
    ".\SERVICES\AutonomousCOOLoopService.js",
    ".\SERVICES\COOOrchestratorService.js",
    ".\SERVICES\SchedulerService.js",
    ".\SERVICES\StartProductionSystem.js",
    ".\TESTS\Test_Build036_SingleExecutionAuthority.js"
)

foreach ($File in $Checks) {
    node --check $File
    if ($LASTEXITCODE -ne 0) {
        throw "Syntax check failed: $File"
    }
}

node .\TESTS\Test_Build036_SingleExecutionAuthority.js
if ($LASTEXITCODE -ne 0) {
    throw "Build 036 regression test failed."
}

Write-Host ""
Write-Host "BUILD 036 INSTALLED AND VALIDATED"
Write-Host "Backup created at: $BackupRoot"
Write-Host ""
Write-Host "Start production with:"
Write-Host "node .\StartMilesProduction.js"

Pop-Location
