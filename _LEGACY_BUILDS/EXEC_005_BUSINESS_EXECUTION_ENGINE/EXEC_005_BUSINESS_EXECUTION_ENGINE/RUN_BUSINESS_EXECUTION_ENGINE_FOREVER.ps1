$ErrorActionPreference = "Stop"
$Root = $env:MILES_ROOT
if ([string]::IsNullOrWhiteSpace($Root)) { $Root = "D:\P2GC_Intelligence\MILES_OS" }
$IntervalSeconds = 300
Write-Host "EXEC_005 Business Execution Engine loop starting. Ctrl+C to stop."
while ($true) {
  Push-Location $Root
  node .\BUILDER\index.js BUSINESS_EXECUTION_ENGINE
  Pop-Location
  Start-Sleep -Seconds $IntervalSeconds
}
