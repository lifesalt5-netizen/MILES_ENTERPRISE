param(
    [string]$Root = "D:\P2GC_Intelligence\MILES_ENTERPRISE"
)

$ErrorActionPreference = "Stop"
$Source = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not (Test-Path -LiteralPath $Root)) {
    throw "MILES root not found: $Root"
}

$serviceDir = Join-Path $Root "SERVICES\registry"
$testDir = Join-Path $Root "TESTS"
$runtimeDir = Join-Path $Root "runtime\enterprise_registry"

New-Item -ItemType Directory -Path $serviceDir -Force | Out-Null
New-Item -ItemType Directory -Path $testDir -Force | Out-Null
New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null

Copy-Item (Join-Path $Source "SERVICES\registry\EnterpriseComponentRegistryService.js") $serviceDir -Force
Copy-Item (Join-Path $Source "SERVICES\registry\EnterpriseCapabilityRegistryService.js") $serviceDir -Force
Copy-Item (Join-Path $Source "TESTS\enterprise_registry.test.js") $testDir -Force
Copy-Item (Join-Path $Source "BuildEnterpriseRegistry.js") (Join-Path $Root "BuildEnterpriseRegistry.js") -Force
Copy-Item (Join-Path $Source "RUN_ENTERPRISE_REGISTRY.ps1") (Join-Path $Root "RUN_ENTERPRISE_REGISTRY.ps1") -Force

Write-Host ""
Write-Host "Files installed." -ForegroundColor Green
Write-Host "Running validation test..." -ForegroundColor Cyan

Push-Location $Root
try {
    node ".\TESTS\enterprise_registry.test.js"
    if ($LASTEXITCODE -ne 0) { throw "Registry test failed." }

    Write-Host ""
    Write-Host "Building live registry..." -ForegroundColor Cyan
    node ".\BuildEnterpriseRegistry.js"
    if ($LASTEXITCODE -ne 0) { throw "Live registry build failed." }
}
finally {
    Pop-Location
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "PHASE 1 COMPLETE: COMPONENT + CAPABILITY REGISTRIES INSTALLED" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host "Runtime output: $runtimeDir"
