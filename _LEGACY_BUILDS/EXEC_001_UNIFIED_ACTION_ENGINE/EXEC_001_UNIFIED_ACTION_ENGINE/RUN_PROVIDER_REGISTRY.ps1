$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "========================================"
Write-Host " EXEC_001 Provider Registry"
Write-Host "========================================"

$Root = $env:MILES_ROOT
if ([string]::IsNullOrWhiteSpace($Root)) {
    $Root = "D:\P2GC_Intelligence\MILES_OS"
}

Write-Host "Root: $Root"
Push-Location $Root
try {
    $env:MILES_ROOT = $Root
    node .\BUILDER\index.js PROVIDER_REGISTRY
}
finally {
    Pop-Location
}
