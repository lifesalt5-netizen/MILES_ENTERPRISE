$ErrorActionPreference = 'Stop'

$Root = 'C:\P2GC_Intelligence\MILES_ENTERPRISE'
$CanonicalBranch = 'agent/miles-full-system-reconciliation-20260815'
$Repo = 'origin'

Set-Location $Root
Write-Host "=== APPROVED MILES + P2GC FULL-SYSTEM RECONCILIATION ==="
Write-Host "Root      : $Root"
Write-Host "Canonical : $CanonicalBranch"
Write-Host "Rule      : replace old runtime; standalone API; lean MILES core; heavy execution is ephemeral; CEO dashboard, opportunities, execution, and prospect demo remain separate surfaces"

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
  'SCRIPTS/MilesEphemeralExecutor.js',
  'SCRIPTS/RunMilesAcceptanceWithLiveMemory.js',
  'SCRIPTS/StartMilesApi.js',
  'SCRIPTS/MilesProductionGuardian.js',
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
  $target = Join-Path $Root ($file -replace '/', '\\')
  $dir = Split-Path $target -Parent
  New-Item -ItemType Directory -Force -Path $dir | Out-Null

  if (Test-Path $target) {
    $backupDir = Join-Path $Root 'DATA\runtime_guardian\pre_reconciliation_backups'
    New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
    $safe = ($file -replace '[\\/:*?"<>|]','_')
    $existingBackups = Get-ChildItem $backupDir -Filter "$safe.before_*" -File -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending
    $existingBackups | Select-Object -Skip 3 | Remove-Item -Force -ErrorAction SilentlyContinue
    Copy-Item $target (Join-Path $backupDir ("${safe}.before_" + (Get-Date -Format 'yyyyMMdd_HHmmss'))) -Force
  }

  Write-Host "[CANONICAL] $file"
  $content = git show "$CanonicalRef`:$file"
  if ($LASTEXITCODE -ne 0) { throw "Unable to fetch canonical file: $file" }
  $content | Set-Content $target -Encoding UTF8
}

function Invoke-Pm2RestartOrCreate([string]$Name, [string]$ScriptPath) {
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $restartOutput = (& pm2 restart $Name 2>&1 | Out-String)
    $restartCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
  }

  if ($restartCode -eq 0) {
    $restartOutput | Out-Host
    return
  }

  if ($restartOutput -match "doesn't exist|not found|unknown process") {
    Write-Host "[PM2] $Name not present; creating process."
    & pm2 start $ScriptPath --name $Name | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "Unable to create PM2 app: $Name" }
    return
  }

  throw "Unable to restart PM2 app $Name. Output: $restartOutput"
}

Write-Host "`n=== PHASE 0: CANONICAL LEAN + EPHEMERAL WORKER RUNTIME ==="
$runtimeChecks = @(
  'CORE\Supervisor.js',
  'SERVICES\ProviderRouterService.js',
  'StartProductionSystem.js',
  'SCRIPTS\MilesEphemeralExecutor.js',
  'SCRIPTS\RunMilesAcceptanceWithLiveMemory.js',
  'SCRIPTS\StartMilesApi.js',
  'SCRIPTS\MilesProductionGuardian.js',
  'SERVICES\WorkforceService.js',
  'CONNECTORS\MILES\connector.js',
  'SERVICES\digital_coo\ExecutiveRuntimeHealthService.js'
)
foreach ($file in $runtimeChecks) {
  node --check $file
  if ($LASTEXITCODE -ne 0) { throw "Lean runtime syntax gate failed: $file" }
  Write-Host "[RUNTIME CHECK OK] $file"
}

Write-Host "`n=== ENSURE STANDALONE MILES API ==="
Invoke-Pm2RestartOrCreate 'miles-api' '.\SCRIPTS\StartMilesApi.js'
Start-Sleep -Seconds 3

Write-Host "`n=== CLEAN REPLACEMENT: MILES WORKER ==="
$oldPidRaw = (pm2 pid miles-worker 2>$null)
$oldPid = 0
[int]::TryParse(($oldPidRaw | Select-Object -First 1), [ref]$oldPid) | Out-Null
Write-Host "Old worker PID: $oldPid"

pm2 stop miles-worker | Out-Host
Start-Sleep -Seconds 5

if ($oldPid -gt 0) {
  $oldProcess = Get-Process -Id $oldPid -ErrorAction SilentlyContinue
  if ($oldProcess) {
    Write-Host "Old worker PID still alive after PM2 stop; terminating PID $oldPid"
    Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
  }
}

$lockOwnerFile = Join-Path $Root 'DATA\runtime\task_queue.lock\owner.json'
if (Test-Path $lockOwnerFile) {
  try {
    $owner = Get-Content $lockOwnerFile -Raw | ConvertFrom-Json
    $ownerProcess = Get-Process -Id ([int]$owner.pid) -ErrorAction SilentlyContinue
    if (-not $ownerProcess) {
      Write-Host "Removing stale TaskQueue lock owned by dead PID $($owner.pid)"
      Remove-Item (Split-Path $lockOwnerFile -Parent) -Recurse -Force -ErrorAction SilentlyContinue
    }
  } catch {
    Write-Host "Removing unreadable stale TaskQueue lock"
    Remove-Item (Split-Path $lockOwnerFile -Parent) -Recurse -Force -ErrorAction SilentlyContinue
  }
}

pm2 start miles-worker | Out-Host
if ($LASTEXITCODE -ne 0) { throw 'Unable to start miles-worker after clean replacement.' }
Start-Sleep -Seconds 45

$workerPid = [int](pm2 pid miles-worker)
$workerProcess = Get-Process -Id $workerPid -ErrorAction SilentlyContinue
if (-not $workerProcess) { throw 'miles-worker is not running after clean replacement.' }
$workerRam = [math]::Round($workerProcess.WorkingSet64 / 1MB, 0)
Write-Host "Lean core settled RAM: $workerRam MB (pid=$workerPid)"
if ($workerRam -gt 1024) {
  Write-Host "[MEMORY TARGET WARNING] Core target is <= 1024 MB; continuing acceptance to collect execution-state evidence."
}
if ($workerRam -ge 3072) {
  throw "Lean core still exceeds hard RAM ceiling before acceptance: $workerRam MB"
}

Write-Host "`n=== PHASE 1: CLEAN GUARDIAN + LIVE-MEMORY MILES ACCEPTANCE ==="
node .\SCRIPTS\MilesProductionGuardian.js --repair
if ($LASTEXITCODE -ne 0) {
  throw 'MILES Guardian failed after standalone API + lean/ephemeral runtime deployment.'
}

Start-Sleep -Seconds 10
node .\SCRIPTS\RunMilesAcceptanceWithLiveMemory.js
if ($LASTEXITCODE -ne 0) {
  $accept = Join-Path $Root 'DATA\runtime_guardian\production_recovery_acceptance_latest.json'
  if (Test-Path $accept) { Get-Content $accept -Raw | Out-Host }
  $mem = Join-Path $Root 'DATA\runtime_guardian\worker_memory_latest.json'
  if (Test-Path $mem) { Get-Content $mem -Raw | Out-Host }
  throw 'MILES production acceptance failed. Prospect demo deployment stopped.'
}

Start-Sleep -Seconds 10
$workerPidAfterAcceptance = [int](pm2 pid miles-worker)
$workerAfterAcceptance = Get-Process -Id $workerPidAfterAcceptance -ErrorAction SilentlyContinue
if (-not $workerAfterAcceptance) { throw 'miles-worker is not running after acceptance.' }
$workerRamAfterAcceptance = [math]::Round($workerAfterAcceptance.WorkingSet64 / 1MB, 0)
Write-Host "Lean core RAM after command acceptance: $workerRamAfterAcceptance MB (pid=$workerPidAfterAcceptance)"
if ($workerRamAfterAcceptance -gt 1024) {
  Write-Host "[MEMORY TARGET WARNING] Core remains above 1024 MB after command execution. Further separation may still be warranted."
}
if ($workerRamAfterAcceptance -ge 3072) {
  throw "Worker exceeded hard RAM ceiling after command acceptance: $workerRamAfterAcceptance MB"
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
Invoke-Pm2RestartOrCreate 'p2gc-growth-demo' '.\StartP2GCGrowthBlueprintDemo.js'
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
Write-Host "MILES API                   : standalone on port 3000"
Write-Host "MILES lean core initial     : $workerRam MB"
Write-Host "MILES core after acceptance : $workerRamAfterAcceptance MB"
Write-Host "MILES production acceptance : PASS"
Write-Host "P2GC sales demo acceptance  : PASS"
Write-Host "Local Git state preserved   : $AfterBranch / $AfterHead"
Write-Host "MILES Command Center        : http://localhost:8787"
Write-Host "P2GC Prospect Sales Demo    : http://127.0.0.1:8791"
Write-Host "Executive Dashboard         : http://127.0.0.1:8737"
Write-Host "Note: Heavy MILES execution/health/autonomous work runs in ephemeral child processes; API is separate; core no longer owns port 3000."
