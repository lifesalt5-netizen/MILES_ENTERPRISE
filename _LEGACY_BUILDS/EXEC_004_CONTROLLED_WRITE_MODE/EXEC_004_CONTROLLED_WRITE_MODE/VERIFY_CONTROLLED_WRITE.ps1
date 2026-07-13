$ErrorActionPreference = "Stop"
$Root = $env:MILES_ROOT
if ([string]::IsNullOrWhiteSpace($Root)) { $Root = "D:\P2GC_Intelligence\MILES_OS" }
Write-Host ""
Write-Host "========================================"
Write-Host " VERIFY EXEC_004 CONTROLLED WRITE MODE"
Write-Host "========================================"
Write-Host "Root: $Root"
$Required = @(
  "SERVICES\ControlledWritePolicyService.js",
  "SERVICES\ControlledWriteAuditService.js",
  "SERVICES\InstantlyControlledWriteService.js",
  "SERVICES\ControlledWriteService.js",
  "BUILDER\BuilderService.js"
)
$Missing = @()
foreach ($Rel in $Required) {
  if (!(Test-Path (Join-Path $Root $Rel))) { $Missing += $Rel }
}
if ($Missing.Count -gt 0) {
  Write-Host "Missing files:" -ForegroundColor Red
  $Missing | ForEach-Object { Write-Host $_ -ForegroundColor Red }
  exit 1
}
Push-Location $Root
try {
  $Output = node .\BUILDER\index.js CONTROLLED_WRITE instantly CREATE_TEST_CAMPAIGN
  Write-Host $Output
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
finally { Pop-Location }
Write-Host ""
Write-Host "EXEC_004 verification passed if ok=true above."
