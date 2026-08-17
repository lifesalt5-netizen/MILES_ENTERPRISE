$ErrorActionPreference = 'Stop'

$Root = 'C:\P2GC_Intelligence\MILES_ENTERPRISE'
$Branch = 'agent/miles-full-system-reconciliation-20260815'
$Repo = 'origin'
Set-Location $Root

Write-Host '=== MILES CANONICAL SOURCE CLOSURE + FINAL ACCEPTANCE ==='
Write-Host 'Rule: sync complete canonical code surface first; preserve runtime data/credentials/Git state; prove dependency graph and executable CEO/product preflight locally; only then touch production runtime.'

git fetch $Repo $Branch | Out-Host
if ($LASTEXITCODE -ne 0) { throw 'Unable to fetch canonical recovery branch.' }
$actual = (git rev-parse FETCH_HEAD).Trim()
$expected = [string]$env:MILES_REPAIR_EXPECTED_COMMIT
$expected = $expected.Trim()
if ($expected -and $actual -ne $expected) {
  throw "STOP: canonical branch changed after validation. Expected $expected but received $actual"
}
Write-Host "Canonical commit: $actual"

$syncPath = Join-Path $Root 'SCRIPTS\SyncCanonicalProductionSource.ps1'
$syncContent = git show 'FETCH_HEAD:SCRIPTS/SyncCanonicalProductionSource.ps1'
if ($LASTEXITCODE -ne 0) { throw 'Unable to obtain canonical source-sync script.' }
New-Item -ItemType Directory -Force -Path (Split-Path $syncPath -Parent) | Out-Null
$syncContent | Set-Content $syncPath -Encoding UTF8

Write-Host "`n=== G0: CANONICAL SOURCE SYNCHRONIZATION ==="
powershell -NoProfile -ExecutionPolicy Bypass -File $syncPath -SourceRoot $Root -DestinationRoot $Root -Ref FETCH_HEAD
if ($LASTEXITCODE -ne 0) { throw 'Canonical source synchronization failed before production repair.' }

Write-Host "`n=== G1: PRODUCTION DEPENDENCY GRAPH ==="
$env:MILES_ROOT = $Root
node .\SCRIPTS\TestProductionDependencyGraphP0.js
if ($LASTEXITCODE -ne 0) { throw 'Production dependency graph is incomplete. Production was not touched.' }

foreach ($required in @(
  '.\CORE\ExecutionActionContracts.js',
  '.\SERVICES\governance\ExecutionActionCapabilityService.js',
  '.\SERVICES\governance\CommandPreflightService.js',
  '.\SERVICES\ProviderAuthorityRegistryService.js',
  '.\SERVICES\revenue\RevenueTruthGateService.js',
  '.\SERVICES\teaming\P2GCPrimeSubTeamingService.js',
  '.\SERVICES\ReplyIntelligenceEngine.js',
  '.\SERVICES\customer\P2GCCustomerDeliveryService.js',
  '.\SERVICES\demo\public\teaming.html',
  '.\TESTS\TestExecutionActionContractsP0.js',
  '.\TESTS\TestConnectorActionContractRuntimeP0.js',
  '.\TESTS\TestCommandPreflightP0.js',
  '.\TESTS\TestRecoverySourceReloadContractP0.js',
  '.\SCRIPTS\TestP2GCPrimeSubTeamingAcceptanceP0.js',
  '.\SCRIPTS\TestP2GCReplyIntelligenceAcceptanceP0.js',
  '.\SCRIPTS\TestP2GCCustomerDeliveryAcceptanceP0.js',
  '.\SCRIPTS\TestP2GCWholeSystemAcceptanceP0.js',
  '.\SCRIPTS\RepairTaskQueueAndCompleteAcceptance.ps1'
)) {
  if (-not (Test-Path $required -PathType Leaf)) { throw "Canonical deployment missing required file: $required" }
}

Write-Host "`n=== G1.5: LOCAL CEO + PRODUCT PREFLIGHT CERTIFICATION (NO PM2 CHANGES) ==="
[void][scriptblock]::Create((Get-Content .\SCRIPTS\RepairTaskQueueAndCompleteAcceptance.ps1 -Raw))
Write-Host '[PASS] inner recovery controller PowerShell parses before production changes'

node .\TESTS\TestProviderAuthorityEnvironmentP0.js
if ($LASTEXITCODE -ne 0) { throw 'Provider environment truth failed locally. Production was not touched.' }

node .\TESTS\TestExecutionActionContractsP0.js
if ($LASTEXITCODE -ne 0) { throw 'Execution action contract failed locally. Production was not touched.' }

node .\TESTS\TestConnectorActionContractRuntimeP0.js
if ($LASTEXITCODE -ne 0) { throw 'Runtime connector action contract failed locally. Production was not touched.' }

node .\TESTS\TestCommandPreflightP0.js
if ($LASTEXITCODE -ne 0) { throw 'CEO command preflight failed locally. Production was not touched.' }

node .\TESTS\TestRecoverySourceReloadContractP0.js
if ($LASTEXITCODE -ne 0) { throw 'Canonical source-reload deployment contract failed locally. Production was not touched.' }

node .\SCRIPTS\TestP2GCPrimeSubTeamingAcceptanceP0.js
if ($LASTEXITCODE -ne 0) { throw 'Sub2Prime/Prime-Sub teaming product contract failed locally. Production was not touched.' }

node .\SCRIPTS\TestP2GCReplyIntelligenceAcceptanceP0.js
if ($LASTEXITCODE -ne 0) { throw 'Reply intelligence and qualified-meeting routing failed locally. Production was not touched.' }

node .\SCRIPTS\TestP2GCCustomerDeliveryAcceptanceP0.js
if ($LASTEXITCODE -ne 0) { throw 'CRM/meeting pipeline/onboarding/client-success product contract failed locally. Production was not touched.' }

Write-Host '[LOCAL PREFLIGHT PASS] source + provider truth + action capability + approval/queue/worker rules + runtime source reload + Sub2Prime + reply intelligence + CRM/meeting/onboarding/client-success behavior verified before PM2 changes.'

Write-Host "`n=== G2+: EXISTING TESTED QUEUE REPAIR + END-TO-END ACCEPTANCE ==="
$env:MILES_REPAIR_EXPECTED_COMMIT = $actual
powershell -NoProfile -ExecutionPolicy Bypass -File .\SCRIPTS\RepairTaskQueueAndCompleteAcceptance.ps1
if ($LASTEXITCODE -ne 0) { throw 'Canonical final acceptance failed.' }
