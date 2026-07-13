$ErrorActionPreference = "Stop"
$Root = $env:MILES_ROOT
if ([string]::IsNullOrWhiteSpace($Root)) { $Root = "D:\P2GC_Intelligence\MILES_OS" }
Write-Host ""
Write-Host "========================================"
Write-Host " VERIFY EXEC_002 PROVIDER CONTROLLERS"
Write-Host "========================================"
Write-Host "Root: $Root"
Push-Location $Root
$result = node .\BUILDER\index.js EXEC_002_VERIFY
Write-Host $result
Pop-Location
Write-Host ""
Write-Host "EXEC_002 verification passed if ok=true above."
