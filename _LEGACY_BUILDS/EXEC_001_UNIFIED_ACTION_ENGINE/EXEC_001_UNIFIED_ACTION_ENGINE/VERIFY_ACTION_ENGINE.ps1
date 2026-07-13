$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "========================================"
Write-Host " VERIFY EXEC_001 ACTION ENGINE"
Write-Host "========================================"

$Root = $env:MILES_ROOT
if ([string]::IsNullOrWhiteSpace($Root)) {
    $Root = "D:\P2GC_Intelligence\MILES_OS"
}

$Required = @(
    "SERVICES\ProviderRegistryService.js",
    "SERVICES\ActionAuditService.js",
    "SERVICES\ActionHistoryService.js",
    "SERVICES\ActionVerificationService.js",
    "SERVICES\ActionRetryService.js",
    "SERVICES\ActionDispatcherService.js",
    "SERVICES\ActionEngineService.js",
    "BUILDER\BuilderService.js"
)

$Missing = @()
foreach ($File in $Required) {
    $Path = Join-Path $Root $File
    if (!(Test-Path $Path)) {
        $Missing += $File
    }
}

if ($Missing.Count -gt 0) {
    Write-Host "Missing files:" -ForegroundColor Red
    $Missing | ForEach-Object { Write-Host "- $_" -ForegroundColor Red }
    throw "EXEC_001 verification failed: missing files."
}

Push-Location $Root
try {
    $env:MILES_ROOT = $Root
    node --check .\SERVICES\ProviderRegistryService.js
    node --check .\SERVICES\ActionAuditService.js
    node --check .\SERVICES\ActionHistoryService.js
    node --check .\SERVICES\ActionVerificationService.js
    node --check .\SERVICES\ActionRetryService.js
    node --check .\SERVICES\ActionDispatcherService.js
    node --check .\SERVICES\ActionEngineService.js
    node --check .\BUILDER\BuilderService.js

    $Registry = node .\BUILDER\index.js PROVIDER_REGISTRY
    Write-Host $Registry

    $Engine = node .\BUILDER\index.js ACTION_ENGINE
    Write-Host $Engine
}
finally {
    Pop-Location
}

Write-Host ""
Write-Host "EXEC_001 verification passed."
