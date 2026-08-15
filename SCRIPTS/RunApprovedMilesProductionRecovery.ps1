$ErrorActionPreference = 'Stop'

$Root = 'C:\P2GC_Intelligence\MILES_ENTERPRISE'
$Branch = 'agent/miles-production-recovery-20260814'
$Repo = 'origin'

Set-Location $Root
Write-Host "=== APPROVED MILES PRODUCTION RECOVERY ==="
Write-Host "Root   : $Root"
Write-Host "Branch : $Branch"

# Pull only the approved recovery artifacts from GitHub. Do not merge unrelated branch content.
git fetch $Repo $Branch | Out-Host
$Ref = 'FETCH_HEAD'

$files = @(
  'SCRIPTS/RepairTaskQueueProcessWideReentrantLockP0.js',
  'SCRIPTS/InstallWorkerMemoryWatchdogP0.js',
  'SCRIPTS/InstallCanonicalRevenueTruthWiringP0_v2.js',
  'SCRIPTS/Install8787WorkforceResultTruthP0_v2.js',
  'SCRIPTS/Install8787DepartmentTruthP0.js',
  'SCRIPTS/InstallMiles8787DepartmentDashboardP0_v5.js',
  'SCRIPTS/InstallExecutiveDashboardTruthP0.js',
  'SCRIPTS/Install8787DemoTruthRoutesP0.js',
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
if ($LASTEXITCODE -ne 0) { throw 'Deployment/guardian validation failed. Review DATA\runtime_guardian\production_recovery_deploy_latest.json' }

Write-Host "`n=== APPROVED RECOVERY COMPLETE ==="
Write-Host "8787 Command Center : http://localhost:8787"
Write-Host "8787 Demo           : http://localhost:8787/demo"
Write-Host "Executive Dashboard : http://127.0.0.1:8737"
Write-Host "Reports             : DATA\runtime_guardian"
