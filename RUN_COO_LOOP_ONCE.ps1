$ErrorActionPreference = "Stop"

$Root = "D:\P2GC_Intelligence\MILES_OS"
$env:MILES_ROOT = $Root
$env:MILES_COO_LOOP_MAX_CYCLES = "1"
$env:MILES_COO_LOOP_INTERVAL_MS = "1000"

Write-Host ""
Write-Host "========================================"
Write-Host " BUILD_036 Continuous COO Loop - ONCE"
Write-Host "========================================"
Write-Host "Root: $Root"
Write-Host ""

Set-Location $Root
node .\BUILDER\index.js COO_LOOP
