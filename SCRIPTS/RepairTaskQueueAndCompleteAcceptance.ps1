$ErrorActionPreference = 'Stop'

$Root = 'C:\P2GC_Intelligence\MILES_ENTERPRISE'
$Branch = 'agent/miles-full-system-reconciliation-20260815'
$Repo = 'origin'

Set-Location $Root
Write-Host '=== MILES TASK QUEUE RECOVERY + FINAL ACCEPTANCE ==='
Write-Host 'Policy: preserve full task history; shrink only the active execution queue; no broad PM2 deletion; quiesce only queue writers; reload every source-updated canonical surface before acceptance.'

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

  throw 'ORION_DEMO_LIVE_READY.db could not be resolved.'
}

function Promote-CanonicalFile([string]$File, [string]$Ref) {
  $target = Join-Path $Root ($File -replace '/', '\')
  $dir = Split-Path $target -Parent
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  Write-Host "[PROMOTE] $File"
  $content = git show "$Ref`:$File"
  if ($LASTEXITCODE -ne 0) { throw "Unable to fetch canonical file: $File" }
  $content | Set-Content $target -Encoding UTF8
}

function Invoke-Node([string]$File, [string]$Failure) {
  node $File
  if ($LASTEXITCODE -ne 0) { throw $Failure }
}

function Stop-MilesProcess([string]$Name) {
  Write-Host "[QUIESCE] $Name"
  node .\SCRIPTS\Pm2DirectCommand.js stop $Name | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "Unable to stop queue writer: $Name" }
}

function Start-QueueWriters {
  Write-Host '[RESTART] canonical queue writers'
  node .\SCRIPTS\ReconcileMilesProductionSurfaces.js miles-worker miles-command-center miles-autonomous-coo | Out-Host
  if ($LASTEXITCODE -ne 0) { throw 'Unable to restore canonical queue writers.' }

  Write-Host '[RESTART] autonomous task-queue maintainer'
  node .\SCRIPTS\ReconcilePm2Process.js miles-queue-maintainer .\SCRIPTS\TaskQueueMaintenanceService.js | Out-Host
  if ($LASTEXITCODE -ne 0) { throw 'Unable to start autonomous task-queue maintainer.' }
}

function Restart-SourceUpdatedSurfaces {
  Write-Host '[RELOAD] source-updated canonical runtime surfaces'
  node .\SCRIPTS\ReconcileMilesProductionSurfaces.js `
    miles-api `
    miles-executive-dashboard `
    miles-desktop-ui `
    p2gc-customer-delivery `
    p2gc-growth-demo | Out-Host
  if ($LASTEXITCODE -ne 0) { throw 'Unable to reload all source-updated canonical runtime surfaces.' }
}

$expected = [string]$env:MILES_REPAIR_EXPECTED_COMMIT
$expected = $expected.Trim()
git fetch $Repo $Branch | Out-Host
if ($LASTEXITCODE -ne 0) { throw 'Unable to fetch canonical recovery branch.' }
$actual = (git rev-parse FETCH_HEAD).Trim()
if ($expected -and $actual -ne $expected) {
  throw "STOP: recovery branch changed after validation. Expected $expected but received $actual"
}
$Ref = 'FETCH_HEAD'
Write-Host "Canonical recovery commit: $actual"

$orionDb = Resolve-OrionDb
$env:ORION_DB = $orionDb
$env:ORION_DB_PATH = $orionDb
Write-Host "Resolved ORION DB: $orionDb"

$promote = @(
  'SCRIPTS/CompactTaskQueueHistory.js',
  'SCRIPTS/TaskQueueMaintenanceService.js',
  'SCRIPTS/TestTaskQueueCompactionP0.js',
  'SCRIPTS/ReconcilePm2Process.js',
  'SCRIPTS/Pm2DirectCommand.js',
  'SCRIPTS/ReconcileMilesProductionSurfaces.js',
  'SCRIPTS/TestMilesCoreHttpProbeP0.js',
  'SCRIPTS/RunMilesAcceptanceWithLiveMemory.js',
  'SCRIPTS/TestMilesProductionRecoveryAcceptanceP0.js',
  'SCRIPTS/TestMilesFinalSurfaceAcceptanceP0.js',
  'SCRIPTS/TestMilesRevenueConnectorAcceptanceP0.js',
  'SCRIPTS/TestP2GCWholeSystemAcceptanceP0.js',
  'SCRIPTS/TestP2GCCustomerDeliveryAcceptanceP0.js',
  'SCRIPTS/TestP2GCGrowthAssetsAcceptanceP0.js',
  'SCRIPTS/TestP2GCGrowthBlueprintDemoAcceptanceP0.js'
)
foreach ($file in $promote) { Promote-CanonicalFile $file $Ref }

Write-Host "`n=== R0: QUEUE REPAIR STATIC + ISOLATED TESTS ==="
foreach ($file in @(
  '.\SCRIPTS\CompactTaskQueueHistory.js',
  '.\SCRIPTS\TaskQueueMaintenanceService.js',
  '.\SCRIPTS\TestTaskQueueCompactionP0.js'
)) {
  node --check $file
  if ($LASTEXITCODE -ne 0) { throw "Syntax validation failed: $file" }
}
Invoke-Node '.\SCRIPTS\TestTaskQueueCompactionP0.js' 'TaskQueue compaction regression test failed; production queue was not touched.'

$queuePath = Join-Path $Root 'DATA\runtime\task_queue.json'
if (-not (Test-Path $queuePath -PathType Leaf)) { throw "Production TaskQueue missing: $queuePath" }
$beforeQueue = Get-Item $queuePath
Write-Host ("Production queue before repair: {0:N2} MB" -f ($beforeQueue.Length / 1MB))

Write-Host "`n=== R1: QUIESCE ONLY TASK-QUEUE WRITERS ==="
$repairFailure = $null
try {
  Stop-MilesProcess 'miles-command-center'
  Stop-MilesProcess 'miles-autonomous-coo'
  Stop-MilesProcess 'miles-worker'
  Start-Sleep -Seconds 4

  Write-Host "`n=== R2: LOSSLESS ACTIVE-QUEUE COMPACTION ==="
  $env:MILES_QUEUE_COMPACT_TRIGGER_BYTES = [string](64MB)
  $env:MILES_QUEUE_COMPACT_TARGET_BYTES = [string](16MB)
  $env:MILES_QUEUE_COMPACT_HARD_BYTES = [string](64MB)
  $env:MILES_QUEUE_COMPACT_RECENT_TERMINAL = '100'
  $env:MILES_QUEUE_COMPACT_LOCK_TIMEOUT_MS = '60000'

  node .\SCRIPTS\CompactTaskQueueHistory.js --apply | Out-Host
  if ($LASTEXITCODE -ne 0) { throw 'Lossless production TaskQueue compaction failed.' }

  $afterQueue = Get-Item $queuePath
  Write-Host ("Production queue after repair : {0:N2} MB" -f ($afterQueue.Length / 1MB))
  if ($afterQueue.Length -gt 64MB) {
    throw "Active TaskQueue remains above 64 MB after safe compaction: $([math]::Round($afterQueue.Length / 1MB,2)) MB"
  }
} catch {
  $repairFailure = $_
} finally {
  try { Start-QueueWriters }
  catch {
    if (-not $repairFailure) { $repairFailure = $_ }
    else { Write-Host "[SECONDARY RESTART FAILURE] $($_.Exception.Message)" }
  }
}
if ($repairFailure) { throw $repairFailure }

Restart-SourceUpdatedSurfaces

Write-Host "`n=== R3: POST-REPAIR SURFACE PROBE ==="
Start-Sleep -Seconds 10
Invoke-Node '.\SCRIPTS\TestMilesCoreHttpProbeP0.js' 'Post-compaction MILES/P2GC HTTP probe failed.'

$maintStatusPath = Join-Path $Root 'DATA\runtime\task_queue_maintenance_status.json'
Start-Sleep -Seconds 2
if (-not (Test-Path $maintStatusPath)) { throw 'Autonomous queue-maintainer status file was not created.' }
$maint = Get-Content $maintStatusPath -Raw | ConvertFrom-Json
if ($maint.ok -ne $true) { throw "Autonomous queue maintainer is not healthy: $($maint.status) $($maint.error)" }
Write-Host "[PASS] autonomous queue maintenance :: $($maint.status)"

Write-Host "`n=== R4: LIVE CEO COMMAND EXECUTION ==="
Invoke-Node '.\SCRIPTS\RunMilesAcceptanceWithLiveMemory.js' 'MILES CEO command execution failed after TaskQueue repair.'

Write-Host "`n=== R5: CUSTOMER + GROWTH DELIVERY ==="
Invoke-Node '.\SCRIPTS\TestP2GCCustomerDeliveryAcceptanceP0.js' 'P2GC customer delivery acceptance failed.'
Invoke-Node '.\SCRIPTS\TestP2GCGrowthAssetsAcceptanceP0.js' 'P2GC growth asset acceptance failed.'

Write-Host "`n=== R6: LIVE REVENUE INTELLIGENCE ==="
Invoke-Node '.\SCRIPTS\TestMilesRevenueConnectorAcceptanceP0.js' 'Live Instantly/ORION acceptance failed.'

Write-Host "`n=== R7: REAL-PROSPECT BLUEPRINT ==="
Invoke-Node '.\SCRIPTS\TestP2GCGrowthBlueprintDemoAcceptanceP0.js' 'Real-prospect Growth Blueprint acceptance failed.'

Write-Host "`n=== R8: WHOLE-SYSTEM MATRIX ==="
$env:P2GC_WHOLE_SYSTEM_STRICT = '0'
Invoke-Node '.\SCRIPTS\TestP2GCWholeSystemAcceptanceP0.js' 'P2GC whole-system matrix failed.'

Write-Host "`n=== R9: FINAL SURFACE + CEO DASHBOARD TRUTH GATE ==="
Invoke-Node '.\SCRIPTS\TestMilesFinalSurfaceAcceptanceP0.js' 'Final surface/CEO truth gate failed.'

node .\SCRIPTS\Pm2DirectCommand.js save | Out-Host
if ($LASTEXITCODE -ne 0) { throw 'Unable to persist repaired PM2 process map.' }

$finalQueue = Get-Item $queuePath
Write-Host ''
Write-Host '=== FINAL END-TO-END PASS ==='
Write-Host ("Active TaskQueue                 : PASS ({0:N2} MB)" -f ($finalQueue.Length / 1MB))
Write-Host 'Full TaskQueue history            : PRESERVED IN DATA\runtime\task_history'
Write-Host 'Autonomous queue maintenance      : PASS'
Write-Host 'MILES CEO command execution       : PASS'
Write-Host 'MILES surfaces                    : PASS'
Write-Host 'P2GC customer/revenue delivery    : PASS'
Write-Host 'Instantly + ORION read truth      : PASS'
Write-Host 'P2GC real-prospect Blueprint      : PASS'
Write-Host 'CEO Dashboard execution path      : PASS'
