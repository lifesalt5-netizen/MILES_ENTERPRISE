$ErrorActionPreference = "Continue"

$Root = "D:\P2GC_Intelligence\MILES_OS"
$env:MILES_ROOT = $Root

if (-not $env:MILES_COO_LOOP_INTERVAL_MS) {
    $env:MILES_COO_LOOP_INTERVAL_MS = "60000"
}

Write-Host ""
Write-Host "========================================"
Write-Host " BUILD_036 Continuous COO Loop Guardian"
Write-Host "========================================"
Write-Host "Root: $Root"
Write-Host "Interval MS: $env:MILES_COO_LOOP_INTERVAL_MS"
Write-Host ""

while ($true) {
    try {
        Set-Location $Root
        node .\BUILDER\index.js COO_LOOP
        Write-Host "COO loop exited normally. Restarting in 10 seconds..."
    }
    catch {
        Write-Host "COO loop crashed: $($_.Exception.Message)"
        Write-Host "Restarting in 10 seconds..."
    }

    Start-Sleep -Seconds 10
}
