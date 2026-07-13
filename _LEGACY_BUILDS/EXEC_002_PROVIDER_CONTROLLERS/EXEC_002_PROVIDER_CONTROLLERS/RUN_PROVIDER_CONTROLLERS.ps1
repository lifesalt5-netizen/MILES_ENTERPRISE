$Root = $env:MILES_ROOT
if ([string]::IsNullOrWhiteSpace($Root)) { $Root = "D:\P2GC_Intelligence\MILES_OS" }
Write-Host ""
Write-Host "========================================"
Write-Host " EXEC_002 Provider Controllers"
Write-Host "========================================"
Write-Host "Root: $Root"
Push-Location $Root
node .\BUILDER\index.js PROVIDER_CONTROLLERS
Pop-Location
