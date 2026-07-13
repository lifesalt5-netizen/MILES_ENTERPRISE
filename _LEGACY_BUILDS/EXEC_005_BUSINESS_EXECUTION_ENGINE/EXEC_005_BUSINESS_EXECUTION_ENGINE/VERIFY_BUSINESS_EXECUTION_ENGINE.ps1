$ErrorActionPreference = "Stop"
$Root = $env:MILES_ROOT
if ([string]::IsNullOrWhiteSpace($Root)) { $Root = "D:\P2GC_Intelligence\MILES_OS" }
Write-Host ""
Write-Host "========================================"
Write-Host " VERIFY EXEC_005 BUSINESS EXECUTION ENGINE"
Write-Host "========================================"
Write-Host "Root: $Root"

$Required = @(
  "SERVICES\BusinessExecutionEngineService.js",
  "SERVICES\ExecutionPlannerService.js",
  "SERVICES\ExecutionSchedulerService.js",
  "SERVICES\ExecutionDispatcherService.js",
  "SERVICES\ExecutionMonitorService.js",
  "SERVICES\RetryManagerService.js",
  "SERVICES\EscalationManagerService.js",
  "SERVICES\ExecutionAuditService.js",
  "BUILDER\BuilderService.js"
)
$Missing = @()
foreach ($r in $Required) { if (!(Test-Path (Join-Path $Root $r))) { $Missing += $r } }
if ($Missing.Count -gt 0) { throw "Missing files: $($Missing -join ', ')" }

Push-Location $Root
$result = node .\BUILDER\index.js BUSINESS_EXECUTION_ENGINE
Pop-Location
Write-Host $result
$obj = $result | ConvertFrom-Json
if ($obj.ok -ne $true) { throw "EXEC_005 verification failed." }
Write-Host ""
Write-Host "EXEC_005 verification passed."
