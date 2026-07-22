# ============================================================
# MILES ENTERPRISE
# BUILD 131 — PROVIDER REGISTRY INTEGRATION
# WINDOWS POWERSHELL 5.1 COMPATIBLE
# Run from the MILES_ENTERPRISE root directory.
# ============================================================

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

$BuildRoot   = Split-Path -Parent $MyInvocation.MyCommand.Path
$MilesRoot   = (Get-Location).Path.TrimEnd('\')
$Services    = Join-Path $MilesRoot "SERVICES"
$Tests       = Join-Path $MilesRoot "TESTS"
$Timestamp   = Get-Date -Format "yyyyMMdd_HHmmss"
$BackupRoot  = Join-Path $MilesRoot ("BACKUPS\BUILD131_" + $Timestamp)

$RegistryFile = Join-Path $Services "ProviderRegistry.js"
$BridgeFile   = Join-Path $Services "BusinessOperationsBridgeService.js"
$RevenueFile  = Join-Path $Services "RevenueMissionSourceService.js"
$PatcherFile  = Join-Path $BuildRoot "ProviderRegistryPatch.js"
$TestSource   = Join-Path $BuildRoot "Test_Build131_ProviderRegistry.js"
$TestTarget   = Join-Path $Tests "Test_Build131_ProviderRegistry.js"

$BackedUpFiles = @()

function Write-Section {
    param([string]$Title)
    Write-Host ""
    Write-Host "============================================================"
    Write-Host (" " + $Title)
    Write-Host "============================================================"
}

function Stop-Build {
    param([string]$Message)
    throw $Message
}

function Get-RelativeMilesPath {
    param([string]$FullPath)

    $rootPrefix = $MilesRoot + "\"
    if ($FullPath.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        return $FullPath.Substring($rootPrefix.Length)
    }

    return [System.IO.Path]::GetFileName($FullPath)
}

function Backup-One {
    param([string]$FilePath)

    if (-not (Test-Path -LiteralPath $FilePath)) {
        return
    }

    $relative = Get-RelativeMilesPath $FilePath
    $target = Join-Path $BackupRoot $relative
    $targetFolder = Split-Path -Parent $target

    if (-not (Test-Path -LiteralPath $targetFolder)) {
        New-Item -ItemType Directory -Path $targetFolder -Force | Out-Null
    }

    Copy-Item -LiteralPath $FilePath -Destination $target -Force
    $script:BackedUpFiles += $FilePath
    Write-Host ("[BACKUP] " + $relative)
}

function Restore-One {
    param([string]$FilePath)

    $relative = Get-RelativeMilesPath $FilePath
    $backup = Join-Path $BackupRoot $relative

    if (Test-Path -LiteralPath $backup) {
        $destinationFolder = Split-Path -Parent $FilePath

        if (-not (Test-Path -LiteralPath $destinationFolder)) {
            New-Item -ItemType Directory -Path $destinationFolder -Force | Out-Null
        }

        Copy-Item -LiteralPath $backup -Destination $FilePath -Force
        Write-Host ("[RESTORED] " + $relative)
    }
}

try {
    Write-Section "BUILD 131 — PROVIDER REGISTRY INTEGRATION"

    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        Stop-Build "Node.js is not available in this PowerShell session."
    }

    $RequiredPaths = @(
        $Services,
        $RegistryFile,
        $BridgeFile,
        $RevenueFile,
        $PatcherFile,
        $TestSource
    )

    foreach ($RequiredPath in $RequiredPaths) {
        if (-not (Test-Path -LiteralPath $RequiredPath)) {
            Stop-Build ("Required path not found: " + $RequiredPath)
        }
    }

    if (-not (Test-Path -LiteralPath $BackupRoot)) {
        New-Item -ItemType Directory -Path $BackupRoot -Force | Out-Null
    }

    if (-not (Test-Path -LiteralPath $Tests)) {
        New-Item -ItemType Directory -Path $Tests -Force | Out-Null
    }

    Write-Section "BACKUP"
    Backup-One $BridgeFile
    Backup-One $RevenueFile
    Backup-One $TestTarget

    Write-Section "PATCH"
    & node $PatcherFile $MilesRoot
    if ($LASTEXITCODE -ne 0) {
        Stop-Build "ProviderRegistryPatch.js failed."
    }

    Copy-Item -LiteralPath $TestSource -Destination $TestTarget -Force

    Write-Section "SYNTAX CHECKS"
    $SyntaxFiles = @(
        $RegistryFile,
        $BridgeFile,
        $RevenueFile,
        $TestTarget
    )

    foreach ($SyntaxFile in $SyntaxFiles) {
        Write-Host ("[CHECK] " + (Get-RelativeMilesPath $SyntaxFile))
        & node --check $SyntaxFile

        if ($LASTEXITCODE -ne 0) {
            Stop-Build ("Syntax check failed: " + $SyntaxFile)
        }
    }

    Write-Section "BUILD 131 TEST"
    & node $TestTarget

    if ($LASTEXITCODE -ne 0) {
        Stop-Build "Build 131 test failed."
    }

    Write-Section "BUILD 130 REGRESSION"

    $RegressionCandidates = @(
        (Join-Path $Tests "Test_Build130_RevenueMissionIntake.js"),
        (Join-Path $Tests "TestBuild130RevenueMissionIntake.js"),
        (Join-Path $Tests "Build130_RevenueMissionIntake.test.js")
    )

    $RegressionTest = $null

    foreach ($Candidate in $RegressionCandidates) {
        if (Test-Path -LiteralPath $Candidate) {
            $RegressionTest = $Candidate
            break
        }
    }

    if ($null -ne $RegressionTest) {
        & node $RegressionTest

        if ($LASTEXITCODE -ne 0) {
            Stop-Build "Build 130 regression failed."
        }
    }
    else {
        Write-Host "[SKIP] Build 130 regression test was not found."
    }

    Write-Section "BUILD 131 COMPLETE"
    Write-Host "STATUS: PASSED"
    Write-Host ("BACKUP: " + $BackupRoot)
    Write-Host "NEXT: BUILD 132 — INSTANTLY LIVE ADAPTER"
}
catch {
    Write-Host ""
    Write-Host ("[BUILD 131 FAILED] " + $_.Exception.Message)

    Write-Section "ROLLBACK"

    foreach ($BackedUpFile in $BackedUpFiles) {
        Restore-One $BackedUpFile
    }

    if (($BackedUpFiles -notcontains $TestTarget) -and (Test-Path -LiteralPath $TestTarget)) {
        Remove-Item -LiteralPath $TestTarget -Force -ErrorAction SilentlyContinue
        Write-Host "[REMOVED] Newly created Build 131 test"
    }

    exit 1
}
