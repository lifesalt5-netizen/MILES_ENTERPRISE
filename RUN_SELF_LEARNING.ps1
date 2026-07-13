$ErrorActionPreference = "Stop"
$Root = "D:\P2GC_Intelligence\MILES_OS"
Write-Host ""
Write-Host "========================================"
Write-Host " BUILD_038 Self Learning Layer"
Write-Host "========================================"
Write-Host "Root: $Root"
Push-Location $Root
try { node ".\BUILDER\index.js" SELF_LEARNING }
finally { Pop-Location }
