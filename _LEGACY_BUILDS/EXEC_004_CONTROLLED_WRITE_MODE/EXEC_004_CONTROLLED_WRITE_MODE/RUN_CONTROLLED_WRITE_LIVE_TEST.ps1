$ErrorActionPreference = "Stop"
$Root = $env:MILES_ROOT
if ([string]::IsNullOrWhiteSpace($Root)) { $Root = "D:\P2GC_Intelligence\MILES_OS" }
Write-Host ""
Write-Host "========================================"
Write-Host " EXEC_004 Controlled Write LIVE TEST"
Write-Host "========================================"
Write-Host "Root: $Root"
Write-Host "Requires: INSTANTLY_API_KEY, MILES_CONTROLLED_WRITE_ENABLED=true, INSTANTLY_WRITE_ENABLED=true"
if ($env:MILES_CONTROLLED_WRITE_ENABLED -ne "true" -or $env:INSTANTLY_WRITE_ENABLED -ne "true") {
  Write-Host "Write flags are not both enabled. Refusing live write." -ForegroundColor Yellow
  exit 1
}
Push-Location $Root
try { node .\BUILDER\index.js CONTROLLED_WRITE instantly CREATE_TEST_CAMPAIGN }
finally { Pop-Location }
