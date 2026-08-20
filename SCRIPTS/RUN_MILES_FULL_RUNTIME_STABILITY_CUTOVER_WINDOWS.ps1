param(
    [string]$Root = "C:\P2GC_Intelligence\MILES_ENTERPRISE",
    [int]$SoakSeconds = 300,
    [int]$SampleIntervalSeconds = 5
)

$ErrorActionPreference = "Stop"
Set-Location $Root

$guard = Join-Path $Root 'SCRIPTS\RuntimeGenerationGuard.js'
$compactor = Join-Path $Root 'SCRIPTS\CompactTaskQueueHistory.js'
$maintainer = Join-Path $Root 'SCRIPTS\TaskQueueMaintenanceService.js'
$queuePath = Join-Path $Root 'DATA\runtime\task_queue.json'
$generationDir = Join-Path $Root 'DATA\runtime\runtime_generations'
$pm2CmdInfo = Get-Command 'pm2.cmd' -ErrorAction SilentlyContinue
if (-not $pm2CmdInfo) { throw 'pm2.cmd was not found. Windows cutover requires the npm command shim so -- arguments are forwarded unchanged.' }
$pm2Cmd = $pm2CmdInfo.Source

foreach ($required in @($guard,$compactor,$maintainer,(Join-Path $Root 'SCRIPTS\project_pm2_jlist.js'))) {
    if (-not (Test-Path $required)) { throw "Missing required runtime file: $required" }
}

function Get-EnvDouble([string]$Name,[double]$Default) {
    $raw = [Environment]::GetEnvironmentVariable($Name)
    if ([string]::IsNullOrWhiteSpace($raw)) { return $Default }
    $value = 0.0
    if ([double]::TryParse($raw,[ref]$value)) { return $value }
    return $Default
}

$MaxWorkerAvgCpuPct = Get-EnvDouble 'MILES_ACCEPT_WORKER_AVG_CPU_PCT' 65
$MaxCooAvgCpuPct = Get-EnvDouble 'MILES_ACCEPT_COO_AVG_CPU_PCT' 40
$MaxMaintainerAvgCpuPct = Get-EnvDouble 'MILES_ACCEPT_MAINTAINER_AVG_CPU_PCT' 20
$MaxRamGrowthMb = Get-EnvDouble 'MILES_ACCEPT_MAX_RAM_GROWTH_MB' 256
$MaxRamGrowthPct = Get-EnvDouble 'MILES_ACCEPT_MAX_RAM_GROWTH_PCT' 25
$MaxQueueMb = Get-EnvDouble 'MILES_ACCEPT_MAX_QUEUE_MB' 24
$MaxSystemRamGrowthMb = Get-EnvDouble 'MILES_ACCEPT_MAX_SYSTEM_RAM_GROWTH_MB' 512
$SampleIntervalSeconds = [Math]::Max(2,$SampleIntervalSeconds)
$SoakSeconds = [Math]::Max(60,$SoakSeconds)

function Get-Pm2Rows {
    $tmp = Join-Path $env:TEMP ("miles_pm2_{0}.json" -f [guid]::NewGuid().ToString('N'))
    try {
        (& $pm2Cmd jlist 2>$null) -join "`n" | Set-Content -LiteralPath $tmp -Encoding UTF8
        & node (Join-Path $Root 'SCRIPTS\project_pm2_jlist.js') $tmp
    } finally { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
}

function Get-Pm2Json {
    return ((& $pm2Cmd jlist 2>$null) -join "`n")
}

function Get-RootNodeProcesses {
    $token = [System.IO.Path]::GetFullPath($Root).TrimEnd('\')
    @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | Where-Object {
        $cmd = [string]$_.CommandLine
        $cmd -and $cmd.IndexOf($token,[System.StringComparison]::OrdinalIgnoreCase) -ge 0
    })
}

function Get-SystemUsedRamMb {
    $os = Get-CimInstance Win32_OperatingSystem
    return [math]::Round((($os.TotalVisibleMemorySize - $os.FreePhysicalMemory) / 1024),1)
}

function Get-TrackedPm2Snapshot {
    $json = Get-Pm2Json
    $rows = @()
    $json | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{for(const p of JSON.parse(s)){if(['miles-worker','miles-autonomous-coo','miles-queue-maintainer'].includes(p.name))console.log([p.name,p.pid,p.pm2_env.restart_time,p.pm2_env.status].join('|'));}})" | ForEach-Object {
        $p = $_ -split '\|'
        if ($p.Count -eq 4) {
            $rows += [pscustomobject]@{
                name=$p[0]; pid=[int]$p[1]; restarts=[int]$p[2]; status=$p[3]
            }
        }
    }
    return @($rows)
}

function Get-RuntimeChildSnapshot([string]$Name) {
    $lease = Join-Path $generationDir "$Name.json"
    if (-not (Test-Path $lease)) {
        return [pscustomobject]@{ name=$Name; childPid=0; ramMB=0.0; cpu=0.0; available=$false }
    }

    try {
        $state = Get-Content -Raw -LiteralPath $lease | ConvertFrom-Json
        $childPid = [int]$state.childPid
        if ($childPid -le 0) {
            return [pscustomobject]@{ name=$Name; childPid=0; ramMB=0.0; cpu=0.0; available=$false }
        }

        $proc = Get-Process -Id $childPid -ErrorAction Stop
        $perf = Get-CimInstance Win32_PerfFormattedData_PerfProc_Process -ErrorAction SilentlyContinue |
            Where-Object { [int]$_.IDProcess -eq $childPid } |
            Select-Object -First 1

        $cpu = if ($perf) { [double]$perf.PercentProcessorTime } else { 0.0 }

        return [pscustomobject]@{
            name=$Name
            childPid=$childPid
            ramMB=[math]::Round(($proc.WorkingSet64 / 1MB),1)
            cpu=[math]::Round($cpu,1)
            available=$true
        }
    } catch {
        return [pscustomobject]@{ name=$Name; childPid=0; ramMB=0.0; cpu=0.0; available=$false }
    }
}

function Get-TrueOrphans {
    $pm2Json = Get-Pm2Json
    $activePids = @()
    $pm2Json | node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{for(const p of JSON.parse(s)){if(Number(p.pid)>0)console.log(p.pid)}})" | ForEach-Object {
        $activePids += [int]$_
    }
    $daemon = Get-CimInstance Win32_Process | Where-Object {
        $_.Name -eq 'node.exe' -and $_.CommandLine -match 'pm2\\lib\\Daemon\.js'
    } | Select-Object -First 1
    if (-not $daemon) { return @() }
    return @(Get-CimInstance Win32_Process | Where-Object {
        $_.Name -eq 'node.exe' -and
        $_.ParentProcessId -eq $daemon.ProcessId -and
        $_.CommandLine -match 'ProcessContainerFork\.js' -and
        $activePids -notcontains [int]$_.ProcessId
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

foreach ($row in $rootRows) { & $pm2Cmd stop $row.pm_id | Out-Null }
Start-Sleep -Seconds 2

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
$env:MILES_QUEUE_COMPACT_TRIGGER_BYTES = '25165824'
$env:MILES_QUEUE_COMPACT_TARGET_BYTES = '12582912'
$env:MILES_QUEUE_COMPACT_HARD_BYTES = '67108864'
& node $compactor --apply --force
if ($LASTEXITCODE -ne 0) { throw 'TaskQueue compaction failed.' }

$currentPm2Names = @()
foreach ($line in @(Get-Pm2Rows)) {
    $parts = ([string]$line) -split "`t",6
    if ($parts.Count -eq 6) { $currentPm2Names += [string]$parts[2] }
}
foreach ($name in @('miles-worker','miles-autonomous-coo','miles-queue-maintainer')) {
    if ($currentPm2Names -contains $name) {
        & $pm2Cmd delete $name | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "Failed to delete existing PM2 runtime: $name" }
    } else {
        Write-Host "PM2 runtime $name not present; delete skipped."
    }
}

Write-Host 'Starting guarded singleton runtimes...'
$env:MILES_QUEUE_MAINTENANCE_INTERVAL_MS = '120000'

$workerStartArgs = @('start',$guard,'--name','miles-worker','--','--runtime','miles-worker','--entry','StartProductionSystem.js')
& $pm2Cmd @workerStartArgs | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Failed to start guarded miles-worker.' }

$cooStartArgs = @('start',$guard,'--name','miles-autonomous-coo','--','--runtime','miles-autonomous-coo','--entry','StartAutonomousCOO.js','--arg','--loop')
& $pm2Cmd @cooStartArgs | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Failed to start guarded miles-autonomous-coo.' }

$maintainerStartArgs = @('start',$guard,'--name','miles-queue-maintainer','--','--runtime','miles-queue-maintainer','--entry','SCRIPTS/TaskQueueMaintenanceService.js')
& $pm2Cmd @maintainerStartArgs | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Failed to start guarded miles-queue-maintainer.' }

foreach ($row in $rootRows | Where-Object { $_.name -notin @('miles-worker','miles-autonomous-coo','miles-queue-maintainer') }) {
    & $pm2Cmd restart $row.pm_id | Out-Null
}

& $pm2Cmd save | Out-Null
Start-Sleep -Seconds 15

$baselineRows = @(Get-TrackedPm2Snapshot)
if ($baselineRows.Count -ne 3) { throw "Expected 3 guarded runtimes, found $($baselineRows.Count)." }

$baseline = @{}
foreach ($row in $baselineRows) {
    $baseline[$row.name] = @{ pid=$row.pid; restarts=$row.restarts }
}

$systemRamBaselineMb = Get-SystemUsedRamMb

$workerErr = Join-Path $env:USERPROFILE '.pm2\logs\miles-worker-error.log'
$cooErr = Join-Path $env:USERPROFILE '.pm2\logs\miles-autonomous-coo-error.log'
$offset = @{}
foreach ($f in @($workerErr,$cooErr)) { $offset[$f] = if(Test-Path $f){(Get-Item $f).Length}else{0} }

$resourceSamples = @{
    'miles-worker' = @()
    'miles-autonomous-coo' = @()
    'miles-queue-maintainer' = @()
}

Write-Host "Soaking runtime for $SoakSeconds seconds with $SampleIntervalSeconds-second child-process resource samples..."
$deadline = (Get-Date).AddSeconds($SoakSeconds)
while ((Get-Date) -lt $deadline) {
    foreach ($name in @('miles-worker','miles-autonomous-coo','miles-queue-maintainer')) {
        $sample = Get-RuntimeChildSnapshot $name
        if ($sample.available) {
            $resourceSamples[$name] += [pscustomobject]@{
                at=Get-Date
                childPid=$sample.childPid
                cpu=[double]$sample.cpu
                ramMB=[double]$sample.ramMB
            }
        }
    }
    Start-Sleep -Seconds $SampleIntervalSeconds
}

$freshFailures = 0
foreach ($f in @($workerErr,$cooErr)) {
    if (-not (Test-Path $f)) { continue }
    $stream = [IO.File]::Open($f,'Open','Read','ReadWrite')
    try {
        [void]$stream.Seek([int64]$offset[$f],[IO.SeekOrigin]::Begin)
        $reader = New-Object IO.StreamReader($stream)
        try { $text = $reader.ReadToEnd() } finally { $reader.Dispose() }
    } finally { $stream.Dispose() }

    foreach ($pattern in @(
        'TaskQueue lock could not be acquired',
        'EXECUTION LOOP ERROR',
        'Queue telemetry temporarily unavailable',
        'UNCAUGHT',
        'FATAL'
    )) {
        $count = ([regex]::Matches($text,[regex]::Escape($pattern),'IgnoreCase')).Count
        if ($count -gt 0) {
            Write-Host "$([IO.Path]::GetFileName($f)) | $pattern | $count"
            $freshFailures += $count
        }
    }
}

$finalRows = @(Get-TrackedPm2Snapshot)
$stable = $true
foreach ($row in $finalRows) {
    $old = $baseline[$row.name]
    Write-Host "$($row.name) guard | pid=$($row.pid) | restarts=$($row.restarts) | status=$($row.status)"
    if (-not $old -or $row.pid -ne $old.pid -or $row.restarts -ne $old.restarts -or $row.status -ne 'online') {
        $stable = $false
    }
}

$resourceHealthy = $true
$thresholds = @{
    'miles-worker' = $MaxWorkerAvgCpuPct
    'miles-autonomous-coo' = $MaxCooAvgCpuPct
    'miles-queue-maintainer' = $MaxMaintainerAvgCpuPct
}

Write-Host ''
Write-Host '----- RESOURCE ACCEPTANCE -----'
foreach ($name in $thresholds.Keys) {
    $samples = @($resourceSamples[$name])
    if ($samples.Count -lt 3) {
        Write-Host "$name | insufficient child-process samples=$($samples.Count)"
        $resourceHealthy = $false
        continue
    }

    $childPids = @($samples | Select-Object -ExpandProperty childPid -Unique)
    if ($childPids.Count -ne 1) {
        Write-Host "$name | child PID changed during soak: $($childPids -join ',')"
        $resourceHealthy = $false
    }

    $avgCpu = [math]::Round((($samples | Measure-Object -Property cpu -Average).Average),1)
    $firstRam = [double]$samples[0].ramMB
    $lastRam = [double]$samples[-1].ramMB
    $ramGrowthMb = [math]::Round(($lastRam - $firstRam),1)
    $ramGrowthPct = if ($firstRam -gt 0) {
        [math]::Round((100 * $ramGrowthMb / $firstRam),1)
    } else { 0 }

    Write-Host "$name child=$($childPids -join ',') | avgCpu=$avgCpu%/$($thresholds[$name])% | ramStart=$firstRam MB | ramEnd=$lastRam MB | ramGrowth=$ramGrowthMb MB ($ramGrowthPct%)"

    if ($avgCpu -gt [double]$thresholds[$name]) { $resourceHealthy = $false }
    if ($ramGrowthMb -gt $MaxRamGrowthMb -and $ramGrowthPct -gt $MaxRamGrowthPct) { $resourceHealthy = $false }
}

$systemRamFinalMb = Get-SystemUsedRamMb
$systemRamGrowthMb = [math]::Round(($systemRamFinalMb - $systemRamBaselineMb),1)
Write-Host "system RAM | baseline=$systemRamBaselineMb MB | final=$systemRamFinalMb MB | growth=$systemRamGrowthMb MB / max=$MaxSystemRamGrowthMb MB"
if ($systemRamGrowthMb -gt $MaxSystemRamGrowthMb) { $resourceHealthy = $false }

$queueMb = if (Test-Path $queuePath) { [math]::Round(((Get-Item $queuePath).Length / 1MB),1) } else { 0 }
Write-Host "TaskQueue | size=$queueMb MB | max=$MaxQueueMb MB"
if ($queueMb -gt $MaxQueueMb) { $resourceHealthy = $false }

$orphans = @(Get-TrueOrphans)

Write-Host ''
Write-Host "True PM2 orphans: $($orphans.Count)"
Write-Host "Fresh critical queue/runtime events: $freshFailures"
Write-Host "Resource acceptance: $resourceHealthy"

if ($stable -and $freshFailures -eq 0 -and $orphans.Count -eq 0 -and $resourceHealthy) {
    Write-Host 'RESULT: GREEN — FULL RUNTIME STABILITY ACCEPTED'
    exit 0
}

Write-Host "RESULT: NOT GREEN | stable=$stable | freshEvents=$freshFailures | orphans=$($orphans.Count) | resources=$resourceHealthy"
exit 1
