param(
    [string]$Root = "C:\P2GC_Intelligence\MILES_ENTERPRISE",
    [int]$SoakSeconds = 300
)

$ErrorActionPreference = "Stop"
Set-Location $Root

$guard = Join-Path $Root 'SCRIPTS\RuntimeGenerationGuard.js'
$compactor = Join-Path $Root 'SCRIPTS\CompactTaskQueueHistory.js'
$maintainer = Join-Path $Root 'SCRIPTS\TaskQueueMaintenanceService.js'
if (-not (Test-Path $guard)) { throw "Missing runtime guard: $guard" }
if (-not (Test-Path $compactor)) { throw "Missing compactor: $compactor" }
if (-not (Test-Path $maintainer)) { throw "Missing queue maintainer: $maintainer" }

function Get-Pm2Rows {
    $tmp = Join-Path $env:TEMP ("miles_pm2_{0}.json" -f [guid]::NewGuid().ToString('N'))
    try {
        (& pm2 jlist 2>$null) -join "`n" | Set-Content -LiteralPath $tmp -Encoding UTF8
        & node (Join-Path $Root 'SCRIPTS\project_pm2_jlist.js') $tmp
    } finally { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
}

function Get-RootNodeProcesses {
    $token = [System.IO.Path]::GetFullPath($Root).TrimEnd('\')
    @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | Where-Object {
        $cmd = [string]$_.CommandLine
        $cmd -and $cmd.IndexOf($token,[System.StringComparison]::OrdinalIgnoreCase) -ge 0
    })
}

Write-Host '============================================================'
Write-Host 'MILES FULL RUNTIME STABILITY CUTOVER'
Write-Host '============================================================'
Write-Host 'Stopping all PM2 entries owned by this MILES root...'

$rows = @(Get-Pm2Rows)
$rootRows = @()
foreach ($line in $rows) {
    $parts = ([string]$line) -split "`t",6
    if ($parts.Count -ne 6) { continue }
    $cwd = [string]$parts[4]
    $exec = [string]$parts[5]
    if (($cwd -like "$Root*") -or ($exec -like "$Root*")) {
        $rootRows += [pscustomobject]@{ pid=[int]$parts[0]; pm_id=[int]$parts[1]; name=$parts[2] }
    }
}

foreach ($row in $rootRows) { & pm2 stop $row.pm_id | Out-Null }
Start-Sleep -Seconds 2

# PM2 on Windows has previously left ProcessContainerFork generations alive.
# After every MILES PM2 entry is stopped, any remaining Node process whose
# command line belongs to this root is obsolete and safe to terminate.
$leftovers = @(Get-RootNodeProcesses)
foreach ($proc in $leftovers) {
    Write-Host "Removing obsolete MILES process pid=$($proc.ProcessId)"
    Stop-Process -Id ([int]$proc.ProcessId) -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 2

$lock = Join-Path $Root 'DATA\runtime\task_queue.lock'
if (Test-Path $lock) {
    Write-Host 'Removing abandoned TaskQueue lock after complete runtime stop.'
    Remove-Item $lock -Recurse -Force
}

Write-Host 'Compacting TaskQueue before restart...'
$env:MILES_QUEUE_COMPACT_TRIGGER_BYTES = 25165824
$env:MILES_QUEUE_COMPACT_TARGET_BYTES = 12582912
$env:MILES_QUEUE_COMPACT_HARD_BYTES = 67108864
& node $compactor --apply --force
if ($LASTEXITCODE -ne 0) { throw 'TaskQueue compaction failed.' }

foreach ($name in @('miles-worker','miles-autonomous-coo','miles-queue-maintainer')) {
    & pm2 delete $name 2>$null | Out-Null
}

Write-Host 'Starting guarded singleton runtimes...'
$env:MILES_QUEUE_COMPACT_TRIGGER_BYTES = '25165824'
$env:MILES_QUEUE_COMPACT_TARGET_BYTES = '12582912'
$env:MILES_QUEUE_MAINTENANCE_INTERVAL_MS = '120000'

& pm2 start $guard --name miles-worker -- --runtime miles-worker --entry StartProductionSystem.js | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Failed to start guarded miles-worker.' }
& pm2 start $guard --name miles-autonomous-coo -- --runtime miles-autonomous-coo --entry StartAutonomousCOO.js --arg --loop | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Failed to start guarded miles-autonomous-coo.' }
& pm2 start $guard --name miles-queue-maintainer -- --runtime miles-queue-maintainer --entry SCRIPTS/TaskQueueMaintenanceService.js | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Failed to start guarded miles-queue-maintainer.' }

foreach ($row in $rootRows | Where-Object { $_.name -notin @('miles-worker','miles-autonomous-coo','miles-queue-maintainer') }) {
    & pm2 restart $row.pm_id | Out-Null
}

& pm2 save | Out-Null
Start-Sleep -Seconds 15

$baseline = @{}
$pm2Json = (& pm2 jlist 2>$null) -join "`n"
$pm2Json | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{for(const p of JSON.parse(s)){if(['miles-worker','miles-autonomous-coo','miles-queue-maintainer'].includes(p.name)) console.log([p.name,p.pid,p.pm2_env.restart_time].join('|'));}})" | ForEach-Object {
    $p = $_ -split '\|'; $baseline[$p[0]] = @{ pid=[int]$p[1]; restarts=[int]$p[2] }
}

$workerErr = Join-Path $env:USERPROFILE '.pm2\logs\miles-worker-error.log'
$cooErr = Join-Path $env:USERPROFILE '.pm2\logs\miles-autonomous-coo-error.log'
$offset = @{}
foreach ($f in @($workerErr,$cooErr)) { $offset[$f] = if(Test-Path $f){(Get-Item $f).Length}else{0} }

Write-Host "Soaking runtime for $SoakSeconds seconds..."
Start-Sleep -Seconds $SoakSeconds

$freshFailures = 0
foreach ($f in @($workerErr,$cooErr)) {
    if (-not (Test-Path $f)) { continue }
    $stream = [IO.File]::Open($f,'Open','Read','ReadWrite')
    try {
        [void]$stream.Seek([int64]$offset[$f],[IO.SeekOrigin]::Begin)
        $reader = New-Object IO.StreamReader($stream)
        try { $text = $reader.ReadToEnd() } finally { $reader.Dispose() }
    } finally { $stream.Dispose() }
    foreach ($pattern in @('TaskQueue lock could not be acquired','EXECUTION LOOP ERROR','Queue telemetry temporarily unavailable','UNCAUGHT','FATAL')) {
        $count = ([regex]::Matches($text,[regex]::Escape($pattern),'IgnoreCase')).Count
        if ($count -gt 0) { Write-Host "$([IO.Path]::GetFileName($f)) | $pattern | $count"; $freshFailures += $count }
    }
}

$finalRows = @()
$pm2Json = (& pm2 jlist 2>$null) -join "`n"
$pm2Json | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{for(const p of JSON.parse(s)){if(['miles-worker','miles-autonomous-coo','miles-queue-maintainer'].includes(p.name)) console.log([p.name,p.pid,p.pm2_env.restart_time,p.pm2_env.status,((p.monit?.memory||0)/1048576).toFixed(1),p.monit?.cpu||0].join('|'));}})" | ForEach-Object { $finalRows += $_ }

$stable = $true
foreach ($line in $finalRows) {
    $p = $line -split '\|'
    $old = $baseline[$p[0]]
    Write-Host "$($p[0]) | pid=$($p[1]) | restarts=$($p[2]) | status=$($p[3]) | ramMB=$($p[4]) | cpu=$($p[5])%"
    if (-not $old -or [int]$p[1] -ne $old.pid -or [int]$p[2] -ne $old.restarts -or $p[3] -ne 'online') { $stable = $false }
}

$activePids = @()
$pm2Json | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{for(const p of JSON.parse(s)){if(Number(p.pid)>0)console.log(p.pid)}})" | ForEach-Object { $activePids += [int]$_ }
$daemon = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'pm2\\lib\\Daemon\.js' } | Select-Object -First 1
$orphans = @()
if ($daemon) {
    $orphans = @(Get-CimInstance Win32_Process | Where-Object {
        $_.Name -eq 'node.exe' -and $_.ParentProcessId -eq $daemon.ProcessId -and $_.CommandLine -match 'ProcessContainerFork\.js' -and $activePids -notcontains [int]$_.ProcessId
    })
}

Write-Host "True PM2 orphans: $($orphans.Count)"
Write-Host "Fresh critical queue/runtime events: $freshFailures"
if ($stable -and $freshFailures -eq 0 -and $orphans.Count -eq 0) {
    Write-Host 'RESULT: GREEN — FULL RUNTIME STABILITY ACCEPTED'
    exit 0
}
Write-Host "RESULT: NOT GREEN | stable=$stable | freshEvents=$freshFailures | orphans=$($orphans.Count)"
exit 1
