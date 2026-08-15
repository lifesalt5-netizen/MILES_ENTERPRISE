$ErrorActionPreference = 'Stop'

$Root = 'C:\P2GC_Intelligence\MILES_ENTERPRISE'
$Branch = 'agent/miles-production-recovery-20260814'
$Repo = 'origin'

Set-Location $Root
Write-Host "=== APPROVED MILES PRODUCTION RECOVERY ==="
Write-Host "Root   : $Root"
Write-Host "Branch : $Branch"

git fetch $Repo $Branch | Out-Host
$Ref = 'FETCH_HEAD'

$files = @(
  'SCRIPTS/RepairTaskQueueProcessWideReentrantLockP0.js',
  'SCRIPTS/InstallWorkerMemoryWatchdogP0.js',
  'SCRIPTS/InstallStartupMemoryProbeP0_v2.js',
  'SCRIPTS/InstallWorkforceServiceMemoryCacheP0_v2.js',
  'SCRIPTS/InstallCanonicalRevenueTruthWiringP0_v2.js',
  'SCRIPTS/Install8787WorkforceResultTruthP0_v2.js',
  'SCRIPTS/Install8787DepartmentTruthP0.js',
  'SCRIPTS/InstallMiles8787DepartmentDashboardP0_v5.js',
  'SCRIPTS/InstallExecutiveDashboardTruthP0.js',
  'SCRIPTS/Install8787DemoTruthRoutesP0.js',
  'SCRIPTS/Install8787HealthTruthP0.js',
  'SCRIPTS/MilesProductionGuardian.js',
  'SCRIPTS/DeployMilesProductionRecoveryAllP0.js',
  'SCRIPTS/TestMilesProductionRecoveryAcceptanceP0.js',
  'SERVICES/digital_coo/DemoTruthReportService.js'
)

foreach ($file in $files) {
  $target = Join-Path $Root ($file -replace '/', '\\')
  $dir = Split-Path $target -Parent
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  Write-Host "[FETCH] $file"
  $content = git show "$Ref`:$file"
  if ($LASTEXITCODE -ne 0) { throw "Unable to fetch approved artifact: $file" }
  $content | Set-Content $target -Encoding UTF8
}

Write-Host "`n=== DEPLOY + CLEAN RUNTIME REPAIR ==="
node .\SCRIPTS\DeployMilesProductionRecoveryAllP0.js --repair-runtime
if ($LASTEXITCODE -ne 0) {
  Write-Host "`n=== ACCEPTANCE / MEMORY EVIDENCE ==="
  $accept = Join-Path $Root 'DATA\runtime_guardian\production_recovery_acceptance_latest.json'
  if (Test-Path $accept) { Get-Content $accept -Raw | Out-Host }
  $probe = Join-Path $Root 'DATA\runtime_guardian\startup_memory_probe.jsonl'
  if (Test-Path $probe) { Get-Content $probe -Tail 16 | Out-Host }
  $mem = Join-Path $Root 'DATA\runtime_guardian\worker_memory_latest.json'
  if (Test-Path $mem) { Get-Content $mem -Raw | Out-Host }
  throw 'Deployment/guardian validation failed. Evidence printed above; ChatGPT can take the next fix directly.'
}

Write-Host "`n=== APPROVED RECOVERY COMPLETE ==="
Write-Host "8787 Command Center : http://localhost:8787"
Write-Host "8787 Demo           : http://localhost:8787/demo"
Write-Host "Executive Dashboard : http://127.0.0.1:8737"
Write-Host "Reports             : DATA\runtime_guardian"
