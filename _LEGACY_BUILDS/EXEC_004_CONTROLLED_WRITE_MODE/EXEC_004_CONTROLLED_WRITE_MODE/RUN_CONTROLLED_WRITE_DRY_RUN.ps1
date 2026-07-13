$ErrorActionPreference = "Stop"
$Root = $env:MILES_ROOT
if ([string]::IsNullOrWhiteSpace($Root)) { $Root = "D:\P2GC_Intelligence\MILES_OS" }
Write-Host ""
Write-Host "========================================"
Write-Host " EXEC_004 Controlled Write Dry Run"
Write-Host "========================================"
Write-Host "Root: $Root"
Push-Location $Root
try { node .\BUILDER\index.js CONTROLLED_WRITE instantly CREATE_TEST_CAMPAIGN }
finally { Pop-Location }
