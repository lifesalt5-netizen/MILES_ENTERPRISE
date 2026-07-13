param(
    [string]$Root = "D:\P2GC_Intelligence\MILES_OS"
)

$ErrorActionPreference = "Stop"
Write-Host ""
Write-Host "========================================"
Write-Host " BUILD_037 Executive Dashboard"
Write-Host "========================================"
Write-Host "Root: $Root"

Push-Location $Root
try {
    node .\BUILDER\index.js EXECUTIVE_DASHBOARD
}
finally {
    Pop-Location
}
