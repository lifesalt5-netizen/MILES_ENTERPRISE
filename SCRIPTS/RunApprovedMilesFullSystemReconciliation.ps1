$ErrorActionPreference = 'Stop'

$Root = 'C:\P2GC_Intelligence\MILES_ENTERPRISE'
$CanonicalBranch = 'agent/miles-full-system-reconciliation-20260815'
$SupportBranch = 'agent/miles-production-recovery-20260814'
$Repo = 'origin'

Set-Location $Root
Write-Host "=== APPROVED MILES + P2GC FULL-SYSTEM RECONCILIATION ==="
Write-Host "Root      : $Root"
Write-Host "Canonical : $CanonicalBranch"
Write-Host "Support   : $SupportBranch"
Write-Host "Rule      : full-system fix; canonical minimal MILES core; CEO dashboard, opportunities, execution, and prospect demo remain separate surfaces"

$LocalBranch = (git branch --show-current).Trim()
$LocalHead = (git rev-parse HEAD).Trim()
Write-Host "Local branch protected: $LocalBranch"
Write-Host "Local HEAD protected  : $LocalHead"

git fetch $Repo $CanonicalBranch | Out-Host
if ($LASTEXITCODE -ne 0) { throw "Unable to fetch canonical reconciliation branch." }
$CanonicalRef = 'FETCH_HEAD'

$canonicalFiles = @(
  'GOVERNANCE/ENGINEERING_FULL_SYSTEM_FIX_RULE.md',
  'CORE/Supervisor.js',
  'SERVICES/ProviderRouterService.js',
  'StartProductionSystem.js',
  'SERVICES/WorkforceService.js',
  'CONNECTORS/MILES/connector.js',
  'SERVICES/digital_coo/ExecutiveRuntimeHealthService.js',
  'SERVICES/revenue/ProspectGrowthAssessmentService.js',
  'SERVICES/revenue/ProspectDemoPresentationService.js',
  'SERVICES/demo/ExecutiveGrowthBlueprintDemoService.js',
  'SERVICES/demo/public/index.html',
  'SERVICES/demo/public/app.js',
  'SERVICES/demo/public/styles.css',
  'StartP2GCGrowthBlueprintDemo.js',
  'SCRIPTS/TestP2GCGrowthBlueprintDemoAcceptanceP0.js'
)

foreach ($file in $canonicalFiles) {
  $target = Join-Path $Root ($file -replace '/', '\')
  $dir = Split-Path $target -Parent
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  if (Test-Path $target) {
    $backupDir = Join-Path $Root 'DATA\runtime_guardian\pre_reconciliation_backups'
    New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
    $safe = ($file -replace '[\/:*?"<>|]','_')
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
  $target = Join-Path $Root ($file -replace '/', '\')
  $dir = Split-Path $target -Parent
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  Write-Host "[SUPPORT] $file"
  $content = git show "$SupportRef`:$file"
  if ($LASTEXITCODE -ne 0) { throw "Unable to fetch verified support file: $file" }
  $content | Set-Content $target -Encoding UTF8
}

Write-Host "`n=== PHASE 0: CANONICAL MINIMAL WORKER RUNTIME ==="
$runtimeChecks = @(
  'CORE\Supervisor.js',
  'SERVICES\ProviderRouterService.js',
  'StartProductionSystem.js',
  'SERVICES\WorkforceService.js',
  'CONNECTORS\MILES\connector.js'
)
foreach ($file in $runtimeChecks) {
  node --check $file
  if ($LASTEXITCODE -ne 0) { throw "Minimal runtime syntax gate failed: $file" }
  Write-Host "[RUNTIME CHECK OK] $file"
}

Write-Host "`n=== CLEAN RESTART: MILES WORKER ONLY ==="
pm2 restart miles-worker | Out-Host
if ($LASTEXITCODE -ne 0) { throw 'Unable to restart miles-worker after canonical minimal-runtime deployment.' }
Start-Sleep -Seconds 60

$workerPid = [int](pm2 pid miles-worker)
$workerProcess = Get-Process -Id $workerPid -ErrorAction SilentlyContinue
if (-not $workerProcess) { throw 'miles-worker is not running after canonical minimal-runtime deployment.' }
$workerRam = [math]::Round($workerProcess.WorkingSet64 / 1MB, 0)
Write-Host "Minimal worker settled RAM: $workerRam MB (pid=$workerPid)"
if ($workerRam -ge 3072) {
  throw "Canonical minimal worker still exceeds hard RAM ceiling before acceptance: $workerRam MB"
}

Write-Host "`n=== PHASE 1: MILES PRODUCTION ACCEPTANCE ==="
node .\SCRIPTS\DeployMilesProductionRecoveryAllP0.js --repair-runtime
if ($LASTEXITCODE -ne 0) {
  $accept = Join-Path $Root 'DATA\runtime_guardian\production_recovery_acceptance_latest.json'
  if (Test-Path $accept) { Get-Content $accept -Raw | Out-Host }
  $mem = Join-Path $Root 'DATA\runtime_guardian\worker_memory_latest.json'
  if (Test-Path $mem) { Get-Content $mem -Raw | Out-Host }
  throw 'MILES production acceptance failed. Prospect demo deployment stopped.'
}

Write-Host "`n=== PHASE 2: STANDALONE PROSPECT DEMO STATIC GATES ==="
$demoChecks = @(
  'SERVICES\revenue\ProspectGrowthAssessmentService.js',
  'SERVICES\revenue\ProspectDemoPresentationService.js',
  'SERVICES\demo\ExecutiveGrowthBlueprintDemoService.js',
  'SERVICES\demo\public\app.js',
  'StartP2GCGrowthBlueprintDemo.js',
  'SCRIPTS\TestP2GCGrowthBlueprintDemoAcceptanceP0.js'
)
foreach ($file in $demoChecks) {
  node --check $file
  if ($LASTEXITCODE -ne 0) { throw "Prospect demo syntax gate failed: $file" }
  Write-Host "[DEMO CHECK OK] $file"
}

Write-Host "`n=== PHASE 3: START SEPARATE P2GC SALES DEMO ==="
pm2 describe p2gc-growth-demo *> $null
if ($LASTEXITCODE -eq 0) {
  pm2 restart p2gc-growth-demo | Out-Host
  if ($LASTEXITCODE -ne 0) { throw 'Unable to restart p2gc-growth-demo.' }
} else {
  pm2 start .\StartP2GCGrowthBlueprintDemo.js --name p2gc-growth-demo | Out-Host
  if ($LASTEXITCODE -ne 0) { throw 'Unable to start p2gc-growth-demo.' }
}
Start-Sleep -Seconds 8
pm2 save | Out-Host

Write-Host "`n=== PHASE 4: REAL-PROSPECT GROWTH BLUEPRINT ACCEPTANCE ==="
node .\SCRIPTS\TestP2GCGrowthBlueprintDemoAcceptanceP0.js
if ($LASTEXITCODE -ne 0) {
  throw 'Standalone P2GC Growth Blueprint demo failed its real-prospect acceptance gate.'
}

$AfterBranch = (git branch --show-current).Trim()
$AfterHead = (git rev-parse HEAD).Trim()
if ($AfterBranch -ne $LocalBranch -or $AfterHead -ne $LocalHead) {
  throw "LOCAL_GIT_STATE_CHANGED_UNEXPECTEDLY: before=$LocalBranch/$LocalHead after=$AfterBranch/$AfterHead"
}

Write-Host "`n=== FULL-SYSTEM RECONCILIATION COMPLETE ==="
Write-Host "MILES minimal-runtime gate   : PASS ($workerRam MB after settle)"
Write-Host "MILES production acceptance : PASS"
Write-Host "P2GC sales demo acceptance  : PASS"
Write-Host "Local Git state preserved   : $AfterBranch / $AfterHead"
Write-Host "MILES Command Center        : http://localhost:8787"
Write-Host "P2GC Prospect Sales Demo    : http://127.0.0.1:8791"
Write-Host "Executive Dashboard         : http://127.0.0.1:8737"
Write-Host "Note: Opportunities remains a separate workspace; no prospect-demo code is installed into the MILES execution surface."
