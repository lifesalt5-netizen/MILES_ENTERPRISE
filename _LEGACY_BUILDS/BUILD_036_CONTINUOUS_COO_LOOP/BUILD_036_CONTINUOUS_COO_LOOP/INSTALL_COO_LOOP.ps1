$ErrorActionPreference = "Stop"

$Root = "D:\P2GC_Intelligence\MILES_OS"
$BuildRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$BackupRoot = Join-Path $Root "BACKUPS\BUILD_036_$Timestamp"

Write-Host ""
Write-Host "========================================"
Write-Host " INSTALL BUILD_036 Continuous COO Loop"
Write-Host "========================================"
Write-Host "Root: $Root"
Write-Host "Build Root: $BuildRoot"
Write-Host "Backup Root: $BackupRoot"
Write-Host ""

if (-not (Test-Path $Root)) {
    New-Item -ItemType Directory -Force -Path $Root | Out-Null
}

New-Item -ItemType Directory -Force -Path $BackupRoot | Out-Null

$Files = @(
    @{ Source = "BUILDER\BuilderService.js"; Target = "BUILDER\BuilderService.js" },
    @{ Source = "SERVICES\ContinuousCOOLoopService.js"; Target = "SERVICES\ContinuousCOOLoopService.js" },
    @{ Source = "SERVICES\QueueRecoveryService.js"; Target = "SERVICES\QueueRecoveryService.js" },
    @{ Source = "SERVICES\HeartbeatService.js"; Target = "SERVICES\HeartbeatService.js" },
    @{ Source = "SERVICES\RuntimeHealthService.js"; Target = "SERVICES\RuntimeHealthService.js" },
    @{ Source = "SERVICES\RestartGuardianService.js"; Target = "SERVICES\RestartGuardianService.js" },
    @{ Source = "SERVICES\LoopSchedulerService.js"; Target = "SERVICES\LoopSchedulerService.js" },
    @{ Source = "SERVICES\JsonFileService.js"; Target = "SERVICES\JsonFileService.js" },
    @{ Source = "SERVICES\TimeUtil.js"; Target = "SERVICES\TimeUtil.js" },
    @{ Source = "VERIFY\VERIFY_COO_LOOP.js"; Target = "VERIFY\VERIFY_COO_LOOP.js" },
    @{ Source = "RUN_COO_LOOP.ps1"; Target = "RUN_COO_LOOP.ps1" },
    @{ Source = "RUN_COO_LOOP_ONCE.ps1"; Target = "RUN_COO_LOOP_ONCE.ps1" },
    @{ Source = "RUN_COO_LOOP_FOREVER.ps1"; Target = "RUN_COO_LOOP_FOREVER.ps1" },
    @{ Source = "VERIFY_COO_LOOP.ps1"; Target = "VERIFY_COO_LOOP.ps1" },
    @{ Source = "README_BUILD_036.md"; Target = "README_BUILD_036.md" },
    @{ Source = "BUILD_036_MANIFEST.json"; Target = "BUILD_036_MANIFEST.json" }
)

foreach ($File in $Files) {
    $Source = Join-Path $BuildRoot $File.Source
    $Target = Join-Path $Root $File.Target
    $TargetDir = Split-Path -Parent $Target

    if (-not (Test-Path $Source)) {
        throw "Missing build source file: $Source"
    }

    if (-not (Test-Path $TargetDir)) {
        New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null
    }

    if (Test-Path $Target) {
        $BackupTarget = Join-Path $BackupRoot $File.Target
        $BackupDir = Split-Path -Parent $BackupTarget
        if (-not (Test-Path $BackupDir)) {
            New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
        }
        Copy-Item -Force $Target $BackupTarget
    }

    Copy-Item -Force $Source $Target
    Write-Host "Installed: $($File.Target)"
}

$RuntimeDir = Join-Path $Root "DATA\runtime"
New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null

Write-Host ""
Write-Host "Running BUILD_036 verification..."
Set-Location $Root
node .\VERIFY\VERIFY_COO_LOOP.js

Write-Host ""
Write-Host "BUILD_036 install complete."
Write-Host "Run once: powershell -ExecutionPolicy Bypass -File .\RUN_COO_LOOP_ONCE.ps1"
Write-Host "Run continuous: powershell -ExecutionPolicy Bypass -File .\RUN_COO_LOOP.ps1"
Write-Host "Run guarded forever: powershell -ExecutionPolicy Bypass -File .\RUN_COO_LOOP_FOREVER.ps1"
