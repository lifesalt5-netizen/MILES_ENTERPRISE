# ============================================================
# MILES ENTERPRISE
# BUILD 131 — PROVIDER REGISTRY INTEGRATION
# Run from the MILES_ENTERPRISE root directory.
# ============================================================

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$BuildRoot   = Split-Path -Parent $MyInvocation.MyCommand.Path
$MilesRoot   = (Get-Location).Path
$Services    = Join-Path $MilesRoot "SERVICES"
$Tests       = Join-Path $MilesRoot "TESTS"
$Timestamp   = Get-Date -Format "yyyyMMdd_HHmmss"
$BackupRoot  = Join-Path $MilesRoot "BACKUPS\BUILD131_$Timestamp"

$RegistryFile = Join-Path $Services "ProviderRegistry.js"
$BridgeFile   = Join-Path $Services "BusinessOperationsBridgeService.js"
$RevenueFile  = Join-Path $Services "RevenueMissionSourceService.js"
$PatcherFile  = Join-Path $BuildRoot "ProviderRegistryPatch.js"
$TestSource   = Join-Path $BuildRoot "Test_Build131_ProviderRegistry.js"
$TestTarget   = Join-Path $Tests "Test_Build131_ProviderRegistry.js"

function Section([string]$Title) {
    Write-Host ""
    Write-Host "============================================================"
    Write-Host " $Title"
    Write-Host "============================================================"
}

function Fail([string]$Message) {
    throw $Message
}

function Backup-One([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return }
    $relative = [System.IO.Path]::GetRelativePath($MilesRoot, $Path)
    $target = Join-Path $BackupRoot $relative
    New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
    Copy-Item -LiteralPath $Path -Destination $target -Force
    Write-Host "[BACKUP] $relative"
}

function Restore-One([string]$Path) {
    $relative = [System.IO.Path]::GetRelativePath($MilesRoot, $Path)
    $backup = Join-Path $BackupRoot $relative
    if (Test-Path -LiteralPath $backup) {
        New-Item -ItemType Directory -Path (Split-Path -Parent $Path) -Force | Out-Null
        Copy-Item -LiteralPath $backup -Destination $Path -Force
        Write-Host "[RESTORED] $relative"
    }
}

try {
    Section "BUILD 131 — PROVIDER REGISTRY INTEGRATION"

    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        Fail "Node.js is not available in this PowerShell session."
    }

    foreach ($required in @($Services, $RegistryFile, $BridgeFile, $RevenueFile, $PatcherFile, $TestSource)) {
        if (-not (Test-Path -LiteralPath $required)) {
            Fail "Required path not found: $required"
        }
    }

    New-Item -ItemType Directory -Path $BackupRoot -Force | Out-Null
    New-Item -ItemType Directory -Path $Tests -Force | Out-Null

    Section "BACKUP"
    Backup-One $BridgeFile
    Backup-One $RevenueFile
    Backup-One $TestTarget

    Section "PATCH"
    & node $PatcherFile $MilesRoot
    if ($LASTEXITCODE -ne 0) { Fail "ProviderRegistryPatch.js failed." }

    Copy-Item -LiteralPath $TestSource -Destination $TestTarget -Force

    Section "SYNTAX CHECKS"
    foreach ($file in @($RegistryFile, $BridgeFile, $RevenueFile, $TestTarget)) {
        Write-Host "[CHECK] $file"
        & node --check $file
        if ($LASTEXITCODE -ne 0) { Fail "Syntax check failed: $file" }
    }

    Section "BUILD 131 TEST"
    & node $TestTarget
    if ($LASTEXITCODE -ne 0) { Fail "Build 131 test failed." }

    Section "BUILD 130 REGRESSION"
    $candidates = @(
        (Join-Path $Tests "Test_Build130_RevenueMissionIntake.js"),
        (Join-Path $Tests "TestBuild130RevenueMissionIntake.js"),
        (Join-Path $Tests "Build130_RevenueMissionIntake.test.js")
    )
    $regression = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if ($regression) {
        & node $regression
        if ($LASTEXITCODE -ne 0) { Fail "Build 130 regression failed." }
    } else {
        Write-Host "[SKIP] Build 130 regression test was not found."
    }

    Section "BUILD 131 COMPLETE"
    Write-Host "STATUS: PASSED"
    Write-Host "BACKUP: $BackupRoot"
    Write-Host "NEXT: BUILD 132 — INSTANTLY LIVE ADAPTER"
}
catch {
    Write-Host ""
    Write-Host "[BUILD 131 FAILED] $($_.Exception.Message)"
    Section "ROLLBACK"
    Restore-One $BridgeFile
    Restore-One $RevenueFile
    Restore-One $TestTarget
    exit 1
}
