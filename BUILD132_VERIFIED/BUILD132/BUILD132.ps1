param(
    [string]$MilesRoot = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0

function Write-Section([string]$Text) {
    Write-Host ""
    Write-Host "============================================================"
    Write-Host " $Text"
    Write-Host "============================================================"
}

function Find-MilesRoot {
    param([string]$ExplicitRoot)

    $candidates = @()
    if ($ExplicitRoot) { $candidates += $ExplicitRoot }
    if ($env:MILES_ROOT) { $candidates += $env:MILES_ROOT }
    $candidates += (Get-Location).Path
    $candidates += (Split-Path -Parent $PSScriptRoot)
    $candidates += (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
    $candidates += "D:\P2GC_Intelligence\MILES_ENTERPRISE"

    foreach ($candidate in $candidates) {
        if (-not $candidate) { continue }
        $resolved = [System.IO.Path]::GetFullPath($candidate)
        if ((Test-Path (Join-Path $resolved "SERVICES\ProviderRegistry.js")) -and
            (Test-Path (Join-Path $resolved "PROVIDERS\providers\InstantlyProvider.js")) -and
            (Test-Path (Join-Path $resolved "CONNECTORS\INSTANTLY\instantly.js"))) {
            return $resolved
        }
    }

    throw "Unable to locate MILES_ENTERPRISE root. Use -MilesRoot with the full path."
}

function Invoke-NodeCheck([string]$File) {
    Write-Host "[CHECK] $File"
    & node --check $File
    if ($LASTEXITCODE -ne 0) { throw "Node syntax check failed: $File" }
}

$Root = Find-MilesRoot -ExplicitRoot $MilesRoot
$Timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$Backup = Join-Path $Root ("BACKUPS\BUILD132_" + $Timestamp)
$RegistryTarget = Join-Path $Root "SERVICES\ProviderRegistry.js"
$AdapterTarget = Join-Path $Root "SERVICES\InstantlyEnterpriseAdapterService.js"
$AdapterSource = Join-Path $PSScriptRoot "Files\SERVICES\InstantlyEnterpriseAdapterService.js"
$PatchScript = Join-Path $PSScriptRoot "Patch.js"
$AdapterTest = Join-Path $PSScriptRoot "Tests\Test_Build132_InstantlyEnterpriseAdapter.js"
$RegistryTest = Join-Path $PSScriptRoot "Tests\Test_Build132_ProviderRegistry.js"

Write-Section "BUILD 132 - INSTANTLY ENTERPRISE ADAPTER"
Write-Host "ROOT: $Root"

try {
    Write-Section "BACKUP"
    New-Item -ItemType Directory -Force -Path (Join-Path $Backup "SERVICES") | Out-Null
    Copy-Item $RegistryTarget (Join-Path $Backup "SERVICES\ProviderRegistry.js") -Force
    if (Test-Path $AdapterTarget) {
        Copy-Item $AdapterTarget (Join-Path $Backup "SERVICES\InstantlyEnterpriseAdapterService.js") -Force
    }
    Write-Host "[BACKUP] $Backup"

    Write-Section "INSTALL"
    Copy-Item $AdapterSource $AdapterTarget -Force
    Write-Host "[INSTALL] SERVICES\InstantlyEnterpriseAdapterService.js"
    & node $PatchScript $Root
    if ($LASTEXITCODE -ne 0) { throw "Patch.js failed." }

    Write-Section "SYNTAX CHECKS"
    Invoke-NodeCheck $AdapterTarget
    Invoke-NodeCheck $RegistryTarget
    Invoke-NodeCheck (Join-Path $Root "PROVIDERS\providers\InstantlyProvider.js")
    Invoke-NodeCheck (Join-Path $Root "CONNECTORS\INSTANTLY\instantly.js")
    Invoke-NodeCheck $AdapterTest
    Invoke-NodeCheck $RegistryTest

    Write-Section "BUILD 132 TESTS"
    & node $AdapterTest $Root
    if ($LASTEXITCODE -ne 0) { throw "Instantly adapter test failed." }
    & node $RegistryTest $Root
    if ($LASTEXITCODE -ne 0) { throw "Provider registry test failed." }

    Write-Section "BUILD 131 REGRESSION"
    $Build131Test = Join-Path $Root "TESTS\Test_Build131_ProviderRegistry.js"
    if (Test-Path $Build131Test) {
        & node $Build131Test
        if ($LASTEXITCODE -ne 0) { throw "Build 131 regression failed." }
    } else {
        Write-Host "[SKIP] Build 131 test file not present in project root."
    }

    Write-Section "BUILD 132 COMPLETE"
    Write-Host "STATUS: PASSED"
    Write-Host "BACKUP: $Backup"
    Write-Host "NEXT: BUILD 133"
}
catch {
    Write-Host ""
    Write-Host "[ERROR] $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "[ROLLBACK] Restoring Build 132 backup..."

    $RegistryBackup = Join-Path $Backup "SERVICES\ProviderRegistry.js"
    $AdapterBackup = Join-Path $Backup "SERVICES\InstantlyEnterpriseAdapterService.js"

    if (Test-Path $RegistryBackup) {
        Copy-Item $RegistryBackup $RegistryTarget -Force
    }

    if (Test-Path $AdapterBackup) {
        Copy-Item $AdapterBackup $AdapterTarget -Force
    } elseif (Test-Path $AdapterTarget) {
        Remove-Item $AdapterTarget -Force
    }

    Write-Host "STATUS: ROLLED BACK" -ForegroundColor Yellow
    exit 1
}
