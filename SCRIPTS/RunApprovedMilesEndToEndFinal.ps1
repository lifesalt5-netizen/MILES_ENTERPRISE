$ErrorActionPreference = 'Stop'

$Root = 'C:\P2GC_Intelligence\MILES_ENTERPRISE'
$Branch = 'agent/miles-full-system-reconciliation-20260815'
$Repo = 'origin'

Set-Location $Root
Write-Host '=== MILES + P2GC FINAL END-TO-END RECOVERY ==='
Write-Host 'Policy: no partial acceptance; exact GitHub-tested runtime files are promoted before production, then every canonical surface and CEO execution path must pass.'

function Resolve-OrionDb {
  $explicit = @($env:ORION_DB, $env:ORION_DB_PATH) | Where-Object { $_ }
  foreach ($candidate in $explicit) {
    if (Test-Path $candidate -PathType Leaf) { return (Resolve-Path $candidate).Path }
  }

  $parent = Split-Path $Root -Parent
  $direct = @(
    (Join-Path $parent 'Orion Demo 6126\orion_live_demo_ready\ORION_DEMO_LIVE_READY.db'),
    'C:\P2GC_Intelligence\Orion Demo 6126\orion_live_demo_ready\ORION_DEMO_LIVE_READY.db',
    'D:\P2GC_Intelligence\Orion Demo 6126\orion_live_demo_ready\ORION_DEMO_LIVE_READY.db',
    (Join-Path $Root 'DATA\orion\ORION_DEMO_LIVE_READY.db')
  )
  foreach ($candidate in $direct) {
    if ($candidate -and (Test-Path $candidate -PathType Leaf)) { return (Resolve-Path $candidate).Path }
  }

  foreach ($searchRoot in @('C:\P2GC_Intelligence', 'D:\P2GC_Intelligence')) {
    if (-not (Test-Path $searchRoot -PathType Container)) { continue }
    $orionDirs = Get-ChildItem -Path $searchRoot -Directory -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -match 'orion' }
    foreach ($dir in $orionDirs) {
      $match = Get-ChildItem -Path $dir.FullName -Filter 'ORION_DEMO_LIVE_READY.db' -File -Recurse -ErrorAction SilentlyContinue |
        Select-Object -First 1
      if ($match) { return $match.FullName }
    }
  }

  throw 'ORION_DEMO_LIVE_READY.db could not be resolved from ORION_DB/ORION_DB_PATH or the C:/D: P2GC_Intelligence roots.'
}

function Promote-CanonicalFile([string]$File, [string]$Ref) {
  $target = Join-Path $Root ($File -replace '/', '\\')
  $dir = Split-Path $target -Parent
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  Write-Host "[PROMOTE] $File"
  $content = git show "$Ref`:$File"
  if ($LASTEXITCODE -ne 0) { throw "Unable to fetch canonical file: $File" }
  $content | Set-Content $target -Encoding UTF8
}

function Invoke-NodeGate([string]$File) {
  node --check $File
  if ($LASTEXITCODE -ne 0) { throw "Syntax gate failed: $File" }
  Write-Host "[CHECK OK] $File"
}

function Invoke-Test([string]$File, [string]$Failure) {
  node $File
  if ($LASTEXITCODE -ne 0) { throw $Failure }
}

$LocalBranch = (git branch --show-current).Trim()
$LocalHead = (git rev-parse HEAD).Trim()

git fetch $Repo $Branch | Out-Host
if ($LASTEXITCODE -ne 0) { throw 'Unable to fetch final reconciliation branch.' }
$Ref = 'FETCH_HEAD'

$orionDb = Resolve-OrionDb
$env:ORION_DB = $orionDb
$env:ORION_DB_PATH = $orionDb
Write-Host "Resolved ORION DB: $orionDb"

$promoteFiles = @(
  'SCRIPTS/TestMilesProductionRecoveryAcceptanceP0.js',
  'SCRIPTS/RunMilesAcceptanceWithLiveMemory.js',
  'SCRIPTS/RunApprovedMilesFullSystemReconciliation.ps1',
  'SCRIPTS/ReconcilePm2Process.js',
  'SCRIPTS/Pm2DirectCommand.js',
  'SCRIPTS/TestReconcilePm2ProcessUnit.js',
  'SCRIPTS/TestReconcilePm2ProcessIntegration.js',
  'SCRIPTS/ReconcileMilesProductionSurfaces.js',
  'SCRIPTS/MilesProductionGuardian.js',
  'SCRIPTS/MilesEphemeralExecutor.js',
  'SCRIPTS/TestMilesCoreHttpProbeP0.js',
  'SCRIPTS/TestMilesFinalSurfaceAcceptanceP0.js',
  'SCRIPTS/TestMilesRevenueConnectorAcceptanceP0.js',
  'SCRIPTS/TestP2GCWholeSystemAcceptanceP0.js',
  'SCRIPTS/StartMilesApi.js',
  'StartProductionSystem.js',
  'CORE/ConnectorManager.js',
  'SERVICES/ExecutionService.js',
  'SERVICES/digital_coo/MilesCommandCenter.js',
  'SERVICES/DashboardServerService.js',
  'SERVICES/governance/PolicyEngineService.js',
  'SERVICES/governance/DemoProtectionService.js',
  'TESTS/Build052GovernanceTest.js',
  'TESTS/TestGovernanceNegationP0.js',
  'TESTS/TestExecutiveMissionExecutionP0.js',
  'TESTS/TestEphemeralConnectorBootstrapP0.js',
  'SERVICES/BusinessExecutionEngineServiceV2.js',
  'SERVICES/BusinessWorkPlannerService.js',
  'SERVICES/BusinessOperationsBridgeService.js',
  'SERVICES/CompanyStateService.js',
  'SERVICES/TaskRouterService.js',
  'SERVICES/ExecutiveDashboardService.js',
  'CONNECTORS/MILES/connector.js',
  'StartExecutiveDashboard.js',
  'StartMiles.js',
  'StartAutonomousCOO.js',
  'CONNECTORS/INSTANTLY/connector.js',
  'CONNECTORS/INSTANTLY/instantly.js',
  'CONNECTORS/ORION/connector.js',
  'SERVICES/customer/P2GCCustomerDeliveryService.js',
  'StartP2GCCustomerDelivery.js',
  'SCRIPTS/TestP2GCCustomerDeliveryAcceptanceP0.js',
  'SERVICES/growth/P2GCGrowthAssetService.js',
  'SCRIPTS/TestP2GCGrowthAssetsAcceptanceP0.js',
  'SERVICES/revenue/ProspectGrowthAssessmentService.js',
  'SERVICES/revenue/ProspectDemoPresentationService.js',
  'SERVICES/demo/ExecutiveGrowthBlueprintDemoService.js',
  'SERVICES/demo/public/index.html',
  'SERVICES/demo/public/app.js',
  'SERVICES/demo/public/styles.css',
  'StartP2GCGrowthBlueprintDemo.js',
  'SCRIPTS/TestP2GCGrowthBlueprintDemoAcceptanceP0.js'
)

foreach ($file in $promoteFiles) { Promote-CanonicalFile $file $Ref }

Write-Host "`n=== PHASE A: STATIC + ISOLATED REGRESSION GATES ==="
$nodeChecks = @(
  'SCRIPTS\TestMilesProductionRecoveryAcceptanceP0.js',
  'SCRIPTS\RunMilesAcceptanceWithLiveMemory.js',
  'SCRIPTS\ReconcilePm2Process.js',
  'SCRIPTS\Pm2DirectCommand.js',
  'SCRIPTS\TestReconcilePm2ProcessUnit.js',
  'SCRIPTS\TestReconcilePm2ProcessIntegration.js',
  'SCRIPTS\ReconcileMilesProductionSurfaces.js',
  'SCRIPTS\MilesProductionGuardian.js',
  'SCRIPTS\MilesEphemeralExecutor.js',
  'SCRIPTS\TestMilesCoreHttpProbeP0.js',
  'SCRIPTS\TestMilesFinalSurfaceAcceptanceP0.js',
  'SCRIPTS\TestMilesRevenueConnectorAcceptanceP0.js',
  'SCRIPTS\TestP2GCWholeSystemAcceptanceP0.js',
  'SCRIPTS\StartMilesApi.js',
  'StartProductionSystem.js',
  'CORE\ConnectorManager.js',
  'SERVICES\ExecutionService.js',
  'SERVICES\digital_coo\MilesCommandCenter.js',
  'SERVICES\DashboardServerService.js',
  'SERVICES\governance\PolicyEngineService.js',
  'SERVICES\governance\DemoProtectionService.js',
  'TESTS\Build052GovernanceTest.js',
  'TESTS\TestGovernanceNegationP0.js',
  'TESTS\TestExecutiveMissionExecutionP0.js',
  'TESTS\TestEphemeralConnectorBootstrapP0.js',
  'SERVICES\BusinessExecutionEngineServiceV2.js',
  'CONNECTORS\MILES\connector.js',
  'StartExecutiveDashboard.js',
  'StartMiles.js',
  'StartAutonomousCOO.js',
  'CONNECTORS\INSTANTLY\connector.js',
  'CONNECTORS\INSTANTLY\instantly.js',
  'CONNECTORS\ORION\connector.js',
  'SERVICES\customer\P2GCCustomerDeliveryService.js',
  'StartP2GCCustomerDelivery.js',
  'SCRIPTS\TestP2GCCustomerDeliveryAcceptanceP0.js',
  'SERVICES\growth\P2GCGrowthAssetService.js',
  'SCRIPTS\TestP2GCGrowthAssetsAcceptanceP0.js',
  'StartP2GCGrowthBlueprintDemo.js',
  'SCRIPTS\TestP2GCGrowthBlueprintDemoAcceptanceP0.js'
)
foreach ($file in $nodeChecks) { Invoke-NodeGate $file }

Invoke-Test '.\SCRIPTS\TestReconcilePm2ProcessUnit.js' 'PM2 reconciliation regression tests failed.'
Invoke-Test '.\SCRIPTS\TestReconcilePm2ProcessIntegration.js' 'PM2 reconciliation integration test failed; production surfaces were not touched.'
Invoke-Test '.\TESTS\Build052GovernanceTest.js' 'Baseline constitutional governance tests failed.'
Invoke-Test '.\TESTS\TestGovernanceNegationP0.js' 'Negation-aware governance tests failed.'
Invoke-Test '.\TESTS\TestExecutiveMissionExecutionP0.js' 'Executive mission execution regression failed.'
Invoke-Test '.\TESTS\TestEphemeralConnectorBootstrapP0.js' 'Ephemeral child connector bootstrap regression failed.'
Invoke-Test '.\SCRIPTS\TestP2GCCustomerDeliveryAcceptanceP0.js' 'P2GC customer delivery acceptance failed.'
Invoke-Test '.\SCRIPTS\TestP2GCGrowthAssetsAcceptanceP0.js' 'P2GC growth asset acceptance failed.'
Invoke-Test '.\SCRIPTS\TestMilesRevenueConnectorAcceptanceP0.js' 'Live Instantly/ORION revenue connector acceptance failed; production surfaces were not changed.'

Write-Host "`n=== PHASE B: CANONICALIZE ALL PRODUCTION SURFACES ==="
node .\SCRIPTS\ReconcileMilesProductionSurfaces.js miles-api miles-worker miles-command-center miles-executive-dashboard miles-desktop-ui miles-autonomous-coo p2gc-customer-delivery p2gc-growth-demo
if ($LASTEXITCODE -ne 0) { throw 'Unable to canonicalize MILES/P2GC production surfaces.' }

Write-Host "`n=== PHASE C: LIVE SURFACE PRE-PROBE ==="
Start-Sleep -Seconds 8
node .\SCRIPTS\TestMilesCoreHttpProbeP0.js
if ($LASTEXITCODE -ne 0) { throw 'Canonical MILES/P2GC HTTP pre-probe failed.' }

Write-Host "`n=== PHASE D: FULL-SYSTEM CORE RECONCILIATION ==="
powershell -NoProfile -ExecutionPolicy Bypass -File .\SCRIPTS\RunApprovedMilesFullSystemReconciliation.ps1
if ($LASTEXITCODE -ne 0) { throw 'FINAL_END_TO_END_RECONCILIATION_FAILED' }

Write-Host "`n=== PHASE E: POST-RECONCILIATION SELF-HEAL ==="
node .\SCRIPTS\ReconcileMilesProductionSurfaces.js
if ($LASTEXITCODE -ne 0) { throw 'Post-reconciliation production surface repair failed.' }
Start-Sleep -Seconds 8
Invoke-Test '.\SCRIPTS\TestMilesCoreHttpProbeP0.js' 'Post-reconciliation live HTTP surface probe failed.'

Write-Host "`n=== PHASE F: LIVE CEO COMMAND EXECUTION ==="
Invoke-Test '.\SCRIPTS\RunMilesAcceptanceWithLiveMemory.js' 'MILES command execution acceptance failed after final surface reconciliation.'

Write-Host "`n=== PHASE G: CUSTOMER + GROWTH DELIVERY ==="
Invoke-Test '.\SCRIPTS\TestP2GCCustomerDeliveryAcceptanceP0.js' 'P2GC customer delivery acceptance failed.'
Invoke-Test '.\SCRIPTS\TestP2GCGrowthAssetsAcceptanceP0.js' 'P2GC growth asset acceptance failed.'

Write-Host "`n=== PHASE H: LIVE REVENUE INTELLIGENCE ==="
Invoke-Test '.\SCRIPTS\TestMilesRevenueConnectorAcceptanceP0.js' 'Live Instantly/ORION revenue connector acceptance failed after reconciliation.'

Write-Host "`n=== PHASE I: REAL-PROSPECT BLUEPRINT ==="
Invoke-Test '.\SCRIPTS\TestP2GCGrowthBlueprintDemoAcceptanceP0.js' 'P2GC real-prospect Growth Blueprint acceptance failed.'

Write-Host "`n=== PHASE J: WHOLE-SYSTEM INTERNAL MATRIX ==="
$env:P2GC_WHOLE_SYSTEM_STRICT = '0'
Invoke-Test '.\SCRIPTS\TestP2GCWholeSystemAcceptanceP0.js' 'P2GC whole-system internal acceptance matrix failed.'

Write-Host "`n=== PHASE K: FINAL SURFACE + CEO TRUTH GATE ==="
node .\SCRIPTS\TestMilesFinalSurfaceAcceptanceP0.js
if ($LASTEXITCODE -ne 0) {
  $surfaceReport = Join-Path $Root 'DATA\runtime_guardian\final_surface_acceptance_latest.json'
  if (Test-Path $surfaceReport) { Get-Content $surfaceReport -Raw | Out-Host }
  throw 'FINAL_SURFACE_ACCEPTANCE_FAILED'
}

node .\SCRIPTS\Pm2DirectCommand.js save | Out-Host
if ($LASTEXITCODE -ne 0) { throw 'Unable to persist final PM2 process map through direct Node transport.' }

$AfterBranch = (git branch --show-current).Trim()
$AfterHead = (git rev-parse HEAD).Trim()
if ($AfterBranch -ne $LocalBranch -or $AfterHead -ne $LocalHead) {
  throw "LOCAL_GIT_STATE_CHANGED_UNEXPECTEDLY: before=$LocalBranch/$LocalHead after=$AfterBranch/$AfterHead"
}

Write-Host ''
Write-Host '=== FINAL END-TO-END PASS ==='
Write-Host 'MILES worker stability           : PASS'
Write-Host 'MILES API / port 3000            : PASS'
Write-Host 'MILES Command Center / 8787      : PASS'
Write-Host 'MILES CEO Dashboard / 8737       : PASS'
Write-Host 'MILES Desktop UI / 3737          : PASS'
Write-Host 'MILES Autonomous COO             : PASS'
Write-Host 'MILES CEO command -> TaskQueue   : PASS'
Write-Host 'Ephemeral connector bootstrap    : PASS'
Write-Host 'MILES worker execution result    : PASS'
Write-Host 'Governance intent/negation       : PASS'
Write-Host 'Demo protection/redaction        : PASS'
Write-Host 'Executive mission chain          : PASS'
Write-Host 'PM2 direct Node transport        : PASS'
Write-Host 'Instantly live read connectivity : PASS'
Write-Host 'ORION live intelligence database : PASS'
Write-Host 'P2GC customer delivery / 8792    : PASS'
Write-Host 'P2GC CRM + client portal         : PASS'
Write-Host 'P2GC subscription/invoice ledger : PASS'
Write-Host 'P2GC Revenue Command Center      : PASS'
Write-Host 'P2GC executive briefs            : PASS'
Write-Host 'Proposal + knowledge libraries   : PASS'
Write-Host 'Social/newsletter/case-study queue: PASS'
Write-Host 'Lead magnets + website backlog   : PASS'
Write-Host 'P2GC prospect demo / 8791        : PASS'
Write-Host 'Real-prospect Blueprint          : PASS'
Write-Host 'Whole-system internal matrix     : PASS'
Write-Host 'Canonical PM2 identities         : PASS'
Write-Host 'Local Git branch/HEAD            : PRESERVED'
Write-Host 'External payment/social/B12 writes: FAIL-CLOSED until provider credentials/approval are configured'
