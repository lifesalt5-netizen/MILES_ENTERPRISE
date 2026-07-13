$ErrorActionPreference = "Stop"
$Root = $env:MILES_ROOT
if ([string]::IsNullOrWhiteSpace($Root)) { $Root = "D:\P2GC_Intelligence\MILES_OS" }
Write-Host ""
Write-Host "========================================"
Write-Host " EXEC_006 Provider Synchronization"
Write-Host "========================================"
Write-Host "Root: $Root"
Push-Location $Root
try { node .\BUILDER\index.js PROVIDER_SYNC }
finally { Pop-Location }
