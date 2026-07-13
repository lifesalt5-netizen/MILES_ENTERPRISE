param(
    [string]$Root = "D:\P2GC_Intelligence\MILES_ENTERPRISE"
)

$ErrorActionPreference = "Stop"
$Source = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not (Test-Path -LiteralPath $Root)) {
    throw "MILES root not found: $Root"
}

$serviceDir = Join-Path $Root "SERVICES\runtime_registry"
$testDir = Join-Path $Root "TESTS"

New-Item -ItemType Directory -Path $serviceDir -Force | Out-Null
New-Item -ItemType Directory -Path $testDir -Force | Out-Null

Copy-Item (Join-Path $Source "SERVICES\runtime_registry\RuntimeRegistryService.js") $serviceDir -Force
Copy-Item (Join-Path $Source "SERVICES\runtime_registry\RuntimeRegistryClient.js") $serviceDir -Force
Copy-Item (Join-Path $Source "TESTS\runtime_registry_v2.test.js") $testDir -Force
Copy-Item (Join-Path $Source "StartRuntimeRegistryService.js") (Join-Path $Root "StartRuntimeRegistryService.js") -Force
Copy-Item (Join-Path $Source "RUN_RUNTIME_REGISTRY_SERVICE.ps1") (Join-Path $Root "RUN_RUNTIME_REGISTRY_SERVICE.ps1") -Force
Copy-Item (Join-Path $Source "RUN_RUNTIME_REGISTRY_SERVICE.bat") (Join-Path $Root "RUN_RUNTIME_REGISTRY_SERVICE.bat") -Force

Push-Location $Root
try {
    Write-Host "Running validation test..." -ForegroundColor Cyan
    node ".\TESTS\runtime_registry_v2.test.js"

    if ($LASTEXITCODE -ne 0) {
        throw "Runtime Registry V2 test failed."
    }

    Write-Host "Checking JavaScript syntax..." -ForegroundColor Cyan
    node --check ".\StartRuntimeRegistryService.js"
    node --check ".\SERVICES\runtime_registry\RuntimeRegistryService.js"
    node --check ".\SERVICES\runtime_registry\RuntimeRegistryClient.js"

    if ($LASTEXITCODE -ne 0) {
        throw "JavaScript syntax validation failed."
    }
}
finally {
    Pop-Location
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "MILES RUNTIME REGISTRY SERVICE V2 INSTALLED" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Start it in a separate PowerShell window with:" -ForegroundColor Yellow
Write-Host "cd $Root"
Write-Host "node StartRuntimeRegistryService.js"
Write-Host ""
Write-Host "Health endpoint:" -ForegroundColor White
Write-Host "http://127.0.0.1:8791/health"
