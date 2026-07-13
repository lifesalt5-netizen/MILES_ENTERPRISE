$ErrorActionPreference = "Stop"
$Root = "D:\P2GC_Intelligence\MILES_OS"
Write-Host ""
Write-Host "========================================"
Write-Host " VERIFY EXEC_003 INSTANTLY LIVE"
Write-Host "========================================"
Write-Host "Root: $Root"
Set-Location $Root
$required = @(
  "SERVICES\InstantlyApiClient.js",
  "SERVICES\InstantlyLiveProviderController.js",
  "SERVICES\InstantlyActionBridgeService.js",
  "SERVICES\InstantlyLiveIntegrationService.js",
  "BUILDER\BuilderService.js"
)
$missing = @()
foreach ($f in $required) { if (!(Test-Path (Join-Path $Root $f))) { $missing += $f } }
if ($missing.Count -gt 0) { throw "Missing files: $($missing -join ', ')" }
foreach ($f in $required) { node -c (Join-Path $Root $f) }
$result = node .\BUILDER\index.js INSTANTLY_HEALTH | Out-String
Write-Host $result
Write-Host "EXEC_003 verification passed if ok=true above. Missing credentials are allowed safe-mode state."
