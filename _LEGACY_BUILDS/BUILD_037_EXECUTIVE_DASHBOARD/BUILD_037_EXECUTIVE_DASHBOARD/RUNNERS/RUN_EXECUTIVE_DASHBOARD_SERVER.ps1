param(
    [string]$Root = "D:\P2GC_Intelligence\MILES_OS",
    [int]$Port = 8737
)

$ErrorActionPreference = "Stop"
Write-Host ""
Write-Host "========================================"
Write-Host " BUILD_037 Executive Dashboard Server"
Write-Host "========================================"
Write-Host "Root: $Root"
Write-Host "URL: http://127.0.0.1:$Port"

$env:MILES_DASHBOARD_PORT = [string]$Port
Push-Location $Root
try {
    node .\BUILDER\index.js DASHBOARD_SERVER
}
finally {
    Pop-Location
}
