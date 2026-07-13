$ErrorActionPreference = "Stop"
$Root = $env:MILES_ROOT
if ([string]::IsNullOrWhiteSpace($Root)) { $Root = "D:\P2GC_Intelligence\MILES_OS" }
Write-Host ""
Write-Host "========================================"
Write-Host " VERIFY EXEC_006 PROVIDER SYNC"
Write-Host "========================================"
Write-Host "Root: $Root"

$Required = @(
    "SERVICES\ProviderAuthorityRegistryService.js",
    "SERVICES\ProviderInterfaceAdapterService.js",
    "SERVICES\ProviderCapabilityBindingService.js",
    "SERVICES\ProviderSynchronizationService.js",
    "SERVICES\InstantlyProviderCompatibilityService.js",
    "BUILDER\BuilderService.js"
)

$Missing = @()
foreach ($File in $Required) {
    $Path = Join-Path $Root $File
    if (!(Test-Path $Path)) { $Missing += $File }
}

if ($Missing.Count -gt 0) {
    Write-Host "Missing required files:"
    $Missing | ForEach-Object { Write-Host " - $_" }
    exit 1
}

Push-Location $Root
try {
    $Output = node .\BUILDER\index.js PROVIDER_SYNC
    Write-Host $Output
    $Json = $Output | ConvertFrom-Json
    if ($Json.ok -ne $true) { throw "Provider sync returned ok=false" }
    if ($Json.summary.errors -gt 0) { throw "Provider sync reported errors: $($Json.summary.errors)" }
    Write-Host ""
    Write-Host "EXEC_006 verification passed."
}
finally { Pop-Location }
