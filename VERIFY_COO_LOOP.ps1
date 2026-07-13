$ErrorActionPreference = "Stop"

$Root = "D:\P2GC_Intelligence\MILES_OS"
$env:MILES_ROOT = $Root

Write-Host ""
Write-Host "========================================"
Write-Host " VERIFY BUILD_036 COO LOOP"
Write-Host "========================================"
Write-Host "Root: $Root"
Write-Host ""

Set-Location $Root
node .\VERIFY\VERIFY_COO_LOOP.js
