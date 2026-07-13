$ErrorActionPreference = "Stop"

$Root = $env:MILES_ROOT
if ([string]::IsNullOrWhiteSpace($Root)) { $Root = "D:\P2GC_Intelligence\MILES_OS" }
$BuildRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$Backup = Join-Path $Root "BACKUPS\EXEC_005_$Timestamp"

Write-Host ""
Write-Host "========================================"
Write-Host " INSTALL EXEC_005 BUSINESS EXECUTION ENGINE"
Write-Host "========================================"
Write-Host "Root: $Root"
Write-Host "BuildRoot: $BuildRoot"
Write-Host "Backup: $Backup"

New-Item -ItemType Directory -Force -Path $Backup | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Root "SERVICES") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Root "BUILDER") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Root "DATA\business_execution") | Out-Null

$Files = @(
  @{src="SERVICES\BusinessExecutionEngineService.js"; dst="SERVICES\BusinessExecutionEngineService.js"},
  @{src="SERVICES\ExecutionPlannerService.js"; dst="SERVICES\ExecutionPlannerService.js"},
  @{src="SERVICES\ExecutionSchedulerService.js"; dst="SERVICES\ExecutionSchedulerService.js"},
  @{src="SERVICES\ExecutionDispatcherService.js"; dst="SERVICES\ExecutionDispatcherService.js"},
  @{src="SERVICES\ExecutionMonitorService.js"; dst="SERVICES\ExecutionMonitorService.js"},
  @{src="SERVICES\RetryManagerService.js"; dst="SERVICES\RetryManagerService.js"},
  @{src="SERVICES\EscalationManagerService.js"; dst="SERVICES\EscalationManagerService.js"},
  @{src="SERVICES\ExecutionAuditService.js"; dst="SERVICES\ExecutionAuditService.js"},
  @{src="BUILDER\BuilderService.js"; dst="BUILDER\BuilderService.js"}
)

foreach ($f in $Files) {
  $src = Join-Path $BuildRoot $f.src
  $dst = Join-Path $Root $f.dst
  if (Test-Path $dst) { Copy-Item $dst (Join-Path $Backup (($f.dst -replace "[\\/:]", "_"))) -Force }
  Copy-Item $src $dst -Force
  Write-Host "Installed $($f.dst)"
}

Write-Host ""
Write-Host "Running EXEC_005 verification..."
powershell -ExecutionPolicy Bypass -File (Join-Path $BuildRoot "VERIFY_BUSINESS_EXECUTION_ENGINE.ps1")
Write-Host ""
Write-Host "EXEC_005 install complete."
Write-Host "Dry run: powershell -ExecutionPolicy Bypass -File .\RUN_BUSINESS_EXECUTION_ENGINE.ps1"
Write-Host "Continuous: powershell -ExecutionPolicy Bypass -File .\RUN_BUSINESS_EXECUTION_ENGINE_FOREVER.ps1"
