$ErrorActionPreference = 'Stop'

$Root = 'C:\P2GC_Intelligence\MILES_ENTERPRISE'
$Branch = 'agent/miles-full-system-reconciliation-20260815'
$Repo = 'origin'

Set-Location $Root
Write-Host '=== MILES + P2GC FINAL END-TO-END RECOVERY ==='
Write-Host 'Policy: no partial acceptance; canonical PM2 identity, worker execution, CEO surfaces, autonomous COO, desktop UI, customer delivery, and real-prospect demo must all pass.'

$LocalBranch = (git branch --show-current).Trim()
$LocalHead = (git rev-parse HEAD).Trim()

git fetch $Repo $Branch | Out-Host
if ($LASTEXITCODE -ne 0) { throw 'Unable to fetch final reconciliation branch.' }
$Ref = 'FETCH_HEAD'

$promoteFiles = @(
  'SCRIPTS/TestMilesProductionRecoveryAcceptanceP0.js',
  'SCRIPTS/RunMilesAcceptanceWithLiveMemory.js',
  'SCRIPTS/RunApprovedMilesFullSystemReconciliation.ps1',
  'SCRIPTS/ReconcilePm2Process.js',
  'SCRIPTS/TestReconcilePm2ProcessUnit.js',
  'SCRIPTS/TestReconcilePm2ProcessIntegration.js',
  'SCRIPTS/ReconcileMilesProductionSurfaces.js',
  'SCRIPTS/TestMilesFinalSurfaceAcceptanceP0.js',
  'SCRIPTS/StartMilesApi.js',
  'StartProductionSystem.js',
  'SERVICES/digital_coo/MilesCommandCenter.js',
  'StartExecutiveDashboard.js',
  'StartMiles.js',
  'StartAutonomousCOO.js',
  'SERVICES/customer/P2GCCustomerDeliveryService.js',
  'StartP2GCCustomerDelivery.js',
  'SCRIPTS/TestP2GCCustomerDeliveryAcceptanceP0.js',
  'SERVICES/revenue/ProspectGrowthAssessmentService.js',
  'SERVICES/revenue/ProspectDemoPresentationService.js',
  'SERVICES/demo/ExecutiveGrowthBlueprintDemoService.js',
  'SERVICES/demo/public/index.html',
  'SERVICES/demo/public/app.js',
  'SERVICES/demo/public/styles.css',
  'StartP2GCGrowthBlueprintDemo.js',
  'SCRIPTS/TestP2GCGrowthBlueprintDemoAcceptanceP0.js'
)

foreach ($file in $promoteFiles) {
  $target = Join-Path $Root ($file -replace '/', '\\')
  $dir = Split-Path $target -Parent
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  Write-Host "[PROMOTE] $file"
  $content = git show "$Ref`:$file"
  if ($LASTEXITCODE -ne 0) { throw "Unable to fetch canonical file: $file" }
  $content | Set-Content $target -Encoding UTF8
}

Write-Host "`n=== PHASE A: STATIC + REGRESSION GATES ==="
$nodeChecks = @(
  'SCRIPTS\TestMilesProductionRecoveryAcceptanceP0.js',
  'SCRIPTS\RunMilesAcceptanceWithLiveMemory.js',
  'SCRIPTS\ReconcilePm2Process.js',
  'SCRIPTS\TestReconcilePm2ProcessUnit.js',
  'SCRIPTS\TestReconcilePm2ProcessIntegration.js',
  'SCRIPTS\ReconcileMilesProductionSurfaces.js',
  'SCRIPTS\TestMilesFinalSurfaceAcceptanceP0.js',
  'SCRIPTS\StartMilesApi.js',
  'StartProductionSystem.js',
  'SERVICES\digital_coo\MilesCommandCenter.js',
  'StartExecutiveDashboard.js',
  'StartMiles.js',
  'StartAutonomousCOO.js',
  'SERVICES\customer\P2GCCustomerDeliveryService.js',
  'StartP2GCCustomerDelivery.js',
  'SCRIPTS\TestP2GCCustomerDeliveryAcceptanceP0.js',
  'StartP2GCGrowthBlueprintDemo.js',
  'SCRIPTS\TestP2GCGrowthBlueprintDemoAcceptanceP0.js'
)
foreach ($file in $nodeChecks) {
  node --check $file
  if ($LASTEXITCODE -ne 0) { throw "Syntax gate failed: $file" }
  Write-Host "[CHECK OK] $file"
}

node .\SCRIPTS\TestReconcilePm2ProcessUnit.js
if ($LASTEXITCODE -ne 0) { throw 'PM2 reconciliation regression tests failed.' }
node .\SCRIPTS\TestP2GCCustomerDeliveryAcceptanceP0.js
if ($LASTEXITCODE -ne 0) { throw 'P2GC customer delivery acceptance failed.' }

Write-Host "`n=== PHASE B: CANONICALIZE CORE PRODUCTION SURFACES ==="
node .\SCRIPTS\ReconcileMilesProductionSurfaces.js miles-api miles-worker miles-command-center miles-executive-dashboard miles-desktop-ui miles-autonomous-coo p2gc-customer-delivery
if ($LASTEXITCODE -ne 0) { throw 'Unable to canonicalize MILES core production surfaces.' }

Write-Host "`n=== PHASE C: CANONICALIZE PROSPECT DEMO PROCESS ==="
node .\SCRIPTS\ReconcileMilesProductionSurfaces.js p2gc-growth-demo
if ($LASTEXITCODE -ne 0) { throw 'Unable to canonicalize P2GC prospect demo process.' }

Write-Host "`n=== PHASE D: EXISTING FULL-SYSTEM RECONCILIATION ==="
$runnerPath = Join-Path $Root 'SCRIPTS\RunApprovedMilesFullSystemReconciliation.ps1'
powershell -NoProfile -ExecutionPolicy Bypass -File $runnerPath
if ($LASTEXITCODE -ne 0) { throw 'FINAL_END_TO_END_RECONCILIATION_FAILED' }

Write-Host "`n=== PHASE E: POST-RECONCILIATION SELF-HEAL ==="
node .\SCRIPTS\ReconcileMilesProductionSurfaces.js
if ($LASTEXITCODE -ne 0) { throw 'Post-reconciliation production surface repair failed.' }
Start-Sleep -Seconds 8

Write-Host "`n=== PHASE F: LIVE CEO COMMAND EXECUTION ACCEPTANCE ==="
node .\SCRIPTS\RunMilesAcceptanceWithLiveMemory.js
if ($LASTEXITCODE -ne 0) { throw 'MILES command execution acceptance failed after final surface reconciliation.' }

Write-Host "`n=== PHASE G: CUSTOMER DELIVERY ACCEPTANCE ==="
node .\SCRIPTS\TestP2GCCustomerDeliveryAcceptanceP0.js
if ($LASTEXITCODE -ne 0) { throw 'P2GC customer delivery acceptance failed.' }

Write-Host "`n=== PHASE H: REAL-PROSPECT BLUEPRINT ACCEPTANCE ==="
node .\SCRIPTS\TestP2GCGrowthBlueprintDemoAcceptanceP0.js
if ($LASTEXITCODE -ne 0) { throw 'P2GC real-prospect Growth Blueprint acceptance failed.' }

Write-Host "`n=== PHASE I: FINAL SURFACE TRUTH GATE ==="
node .\SCRIPTS\TestMilesFinalSurfaceAcceptanceP0.js
if ($LASTEXITCODE -ne 0) {
  $surfaceReport = Join-Path $Root 'DATA\runtime_guardian\final_surface_acceptance_latest.json'
  if (Test-Path $surfaceReport) { Get-Content $surfaceReport -Raw | Out-Host }
  throw 'FINAL_SURFACE_ACCEPTANCE_FAILED'
}

pm2 save | Out-Host
if ($LASTEXITCODE -ne 0) { throw 'Unable to persist final PM2 process map.' }

$AfterBranch = (git branch --show-current).Trim()
$AfterHead = (git rev-parse HEAD).Trim()
if ($AfterBranch -ne $LocalBranch -or $AfterHead -ne $LocalHead) {
  throw "LOCAL_GIT_STATE_CHANGED_UNEXPECTEDLY: before=$LocalBranch/$LocalHead after=$AfterBranch/$AfterHead"
}

Write-Host ''
Write-Host '=== FINAL END-TO-END PASS ==='
Write-Host 'MILES worker stability          : PASS'
Write-Host 'MILES API / port 3000           : PASS'
Write-Host 'MILES Command Center / 8787     : PASS'
Write-Host 'MILES CEO Dashboard / 8737      : PASS'
Write-Host 'MILES Desktop UI / 3737         : PASS'
Write-Host 'MILES Autonomous COO            : PASS'
Write-Host 'MILES command execution         : PASS'
Write-Host 'MILES persisted result truth    : PASS'
Write-Host 'P2GC customer delivery / 8792   : PASS'
Write-Host 'P2GC CRM + client portal        : PASS'
Write-Host 'P2GC subscription/invoice ledger: PASS'
Write-Host 'P2GC Revenue Command Center     : PASS'
Write-Host 'P2GC executive briefs           : PASS'
Write-Host 'P2GC prospect demo / 8791       : PASS'
Write-Host 'Real-prospect Blueprint         : PASS'
Write-Host 'Canonical PM2 identities        : PASS'
Write-Host 'Local Git branch/HEAD           : PRESERVED'
Write-Host 'External payment charging       : FAIL-CLOSED until provider credentials/approval are configured'
