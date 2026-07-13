$ErrorActionPreference = "Stop"

$Root = "D:\P2GC_Intelligence\MILES_OS"
$env:MILES_ROOT = $Root

Write-Host ""
Write-Host "========================================"
Write-Host " BUILD_036 Continuous COO Loop"
Write-Host "========================================"
Write-Host "Root: $Root"
Write-Host ""

Set-Location $Root
node .\BUILDER\index.js COO_LOOP
