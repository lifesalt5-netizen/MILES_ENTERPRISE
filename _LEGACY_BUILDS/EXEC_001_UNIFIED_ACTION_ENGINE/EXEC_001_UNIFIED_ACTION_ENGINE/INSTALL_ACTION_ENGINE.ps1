$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "========================================"
Write-Host " INSTALL EXEC_001 UNIFIED ACTION ENGINE"
Write-Host "========================================"

$Root = $env:MILES_ROOT
if ([string]::IsNullOrWhiteSpace($Root)) {
    $Root = "D:\P2GC_Intelligence\MILES_OS"
}

$BuildRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$Backup = Join-Path $Root "BACKUPS\EXEC_001_$Timestamp"

Write-Host "Root: $Root"
Write-Host "BuildRoot: $BuildRoot"
Write-Host "Backup: $Backup"

New-Item -ItemType Directory -Force -Path $Backup | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Root "SERVICES") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Root "BUILDER") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Root "DATA\action_engine") | Out-Null

$Files = @(
    @{ Source = "SERVICES\ProviderRegistryService.js"; Target = "SERVICES\ProviderRegistryService.js" },
    @{ Source = "SERVICES\ActionAuditService.js"; Target = "SERVICES\ActionAuditService.js" },
    @{ Source = "SERVICES\ActionHistoryService.js"; Target = "SERVICES\ActionHistoryService.js" },
    @{ Source = "SERVICES\ActionVerificationService.js"; Target = "SERVICES\ActionVerificationService.js" },
    @{ Source = "SERVICES\ActionRetryService.js"; Target = "SERVICES\ActionRetryService.js" },
    @{ Source = "SERVICES\ActionDispatcherService.js"; Target = "SERVICES\ActionDispatcherService.js" },
    @{ Source = "SERVICES\ActionEngineService.js"; Target = "SERVICES\ActionEngineService.js" },
    @{ Source = "BUILDER\BuilderService.js"; Target = "BUILDER\BuilderService.js" }
)

foreach ($File in $Files) {
    $Source = Join-Path $BuildRoot $File.Source
    $Target = Join-Path $Root $File.Target
    $TargetDir = Split-Path -Parent $Target
    New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null

    if (Test-Path $Target) {
        $BackupTarget = Join-Path $Backup $File.Target
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $BackupTarget) | Out-Null
        Copy-Item $Target $BackupTarget -Force
    }

    Copy-Item $Source $Target -Force
    Write-Host "Installed $($File.Target)"
}

Write-Host ""
Write-Host "Running EXEC_001 verification..."
Push-Location $Root
try {
    $env:MILES_ROOT = $Root
    node .\BUILDER\index.js PROVIDER_REGISTRY
    node .\BUILDER\index.js ACTION_ENGINE
}
finally {
    Pop-Location
}

Write-Host ""
Write-Host "EXEC_001 install complete."
Write-Host "Run: powershell -ExecutionPolicy Bypass -File .\RUN_ACTION_ENGINE.ps1"
Write-Host "Verify: powershell -ExecutionPolicy Bypass -File .\VERIFY_ACTION_ENGINE.ps1"
