$ErrorActionPreference = 'Stop'

$Root = 'C:\P2GC_Intelligence\MILES_ENTERPRISE'
$CanonicalBranch = 'agent/miles-full-system-reconciliation-20260815'
$SupportBranch = 'agent/miles-production-recovery-20260814'
$Repo = 'origin'

Set-Location $Root
Write-Host "=== APPROVED MILES FULL-SYSTEM RECONCILIATION ==="
Write-Host "Root      : $Root"
Write-Host "Canonical : $CanonicalBranch"
Write-Host "Support   : $SupportBranch"
Write-Host "Policy    : GOVERNANCE/ENGINEERING_FULL_SYSTEM_FIX_RULE.md"

# Preserve the user's checked-out branch and local commit. This runner never
# checkout/reset/merge/rebase/force-updates the local repository.
$LocalBranch = (git branch --show-current).Trim()
$LocalHead = (git rev-parse HEAD).Trim()
Write-Host "Local branch protected: $LocalBranch"
Write-Host "Local HEAD protected  : $LocalHead"

git fetch $Repo $CanonicalBranch | Out-Host
if ($LASTEXITCODE -ne 0) { throw "Unable to fetch canonical reconciliation branch." }
$CanonicalRef = 'FETCH_HEAD'

$canonicalFiles = @(
  'GOVERNANCE/ENGINEERING_FULL_SYSTEM_FIX_RULE.md',
  'SERVICES/WorkforceService.js',
  'CONNECTORS/MILES/connector.js',
  'SERVICES/digital_coo/ExecutiveRuntimeHealthService.js'
)

foreach ($file in $canonicalFiles) {
  $target = Join-Path $Root ($file -replace '/', '\\')
  $dir = Split-Path $target -Parent
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  if (Test-Path $target) {
    $backupDir = Join-Path $Root 'DATA\runtime_guardian\pre_reconciliation_backups'
    New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
    $safe = ($file -replace '[\\/:*?"<>|]','_')
    Copy-Item $target (Join-Path $backupDir ("${safe}.before_" + (Get-Date -Format 'yyyyMMdd_HHmmss'))) -Force
  }
  Write-Host "[CANONICAL] $file"
  $content = git show "$CanonicalRef`:$file"
  if ($LASTEXITCODE -ne 0) { throw "Unable to fetch canonical file: $file" }
  $content | Set-Content $target -Encoding UTF8
}

git fetch $Repo $SupportBranch | Out-Host
if ($LASTEXITCODE -ne 0) { throw "Unable to fetch verified support branch." }
$SupportRef = 'FETCH_HEAD'

$supportFiles = @(
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
  'SCRIPTS/Install8787HealthTruthP0_v2.js',
  'SCRIPTS/MilesProductionGuardian.js',
  'SCRIPTS/DeployMilesProductionRecoveryAllP0.js',
  'SCRIPTS/TestMilesProductionRecoveryAcceptanceP0.js',
  'SERVICES/digital_coo/DemoTruthReportService.js'
)

foreach ($file in $supportFiles) {
  $target = Join-Path $Root ($file -replace '/', '\\')
  $dir = Split-Path $target -Parent
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  Write-Host "[SUPPORT] $file"
  $content = git show "$SupportRef`:$file"
  if ($LASTEXITCODE -ne 0) { throw "Unable to fetch verified support file: $file" }
  $content | Set-Content $target -Encoding UTF8
}

Write-Host "`n=== CONSOLIDATED DEPLOY + CLEAN RUNTIME REPAIR ==="
node .\SCRIPTS\DeployMilesProductionRecoveryAllP0.js --repair-runtime
$DeployExit = $LASTEXITCODE

if ($DeployExit -ne 0) {
  Write-Host "`n=== FULL-SYSTEM ACCEPTANCE / MEMORY EVIDENCE ==="
  $deploy = Join-Path $Root 'DATA\runtime_guardian\production_recovery_deploy_latest.json'
  if (Test-Path $deploy) { Get-Content $deploy -Raw | Out-Host }
  $accept = Join-Path $Root 'DATA\runtime_guardian\production_recovery_acceptance_latest.json'
  if (Test-Path $accept) { Get-Content $accept -Raw | Out-Host }
  $probe = Join-Path $Root 'DATA\runtime_guardian\startup_memory_probe.jsonl'
  if (Test-Path $probe) { Get-Content $probe -Tail 24 | Out-Host }
  $mem = Join-Path $Root 'DATA\runtime_guardian\worker_memory_latest.json'
  if (Test-Path $mem) { Get-Content $mem -Raw | Out-Host }
  throw 'Full-system reconciliation failed an acceptance gate. No local branch history was changed.'
}

$AfterBranch = (git branch --show-current).Trim()
$AfterHead = (git rev-parse HEAD).Trim()
if ($AfterBranch -ne $LocalBranch -or $AfterHead -ne $LocalHead) {
  throw "LOCAL_GIT_STATE_CHANGED_UNEXPECTEDLY: before=$LocalBranch/$LocalHead after=$AfterBranch/$AfterHead"
}

Write-Host "`n=== MILES FULL-SYSTEM RECONCILIATION COMPLETE ==="
Write-Host "Local Git state preserved: $AfterBranch / $AfterHead"
Write-Host "8787 Command Center : http://localhost:8787"
Write-Host "8787 Demo           : http://localhost:8787/demo"
Write-Host "Executive Dashboard : http://127.0.0.1:8737"
Write-Host "Reports             : DATA\runtime_guardian"
