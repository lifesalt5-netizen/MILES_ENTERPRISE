$ErrorActionPreference = "Stop"
$Root = $env:MILES_ROOT
if ([string]::IsNullOrWhiteSpace($Root)) { $Root = "D:\P2GC_Intelligence\MILES_OS" }
Write-Host ""
Write-Host "========================================"
Write-Host " EXEC_005 Business Execution Engine"
Write-Host "========================================"
Write-Host "Root: $Root"
Push-Location $Root
node .\BUILDER\index.js BUSINESS_EXECUTION_ENGINE
Pop-Location
