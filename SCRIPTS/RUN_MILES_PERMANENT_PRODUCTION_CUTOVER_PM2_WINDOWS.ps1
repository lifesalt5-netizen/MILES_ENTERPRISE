param(
    [Parameter(Mandatory=$true)][string]$CandidateRoot,
    [string]$LiveRoot = "C:\P2GC_Intelligence\MILES_ENTERPRISE",
    [Parameter(Mandatory=$true)][string]$ExpectedCommit,
    [int]$TimeoutSeconds = 180
)

$ErrorActionPreference = "Stop"
$ports = @(3000,8787,3737,8737)
$parentRoot = Split-Path -Parent $LiveRoot
$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$rollbackRoot = Join-Path $parentRoot ("MILES_ENTERPRISE_ROLLBACK_{0}" -f $stamp)
$failedRoot = Join-Path $parentRoot ("MILES_ENTERPRISE_FAILED_{0}" -f $stamp)
$candidateDataPark = Join-Path $parentRoot ("MILES_ENTERPRISE_CANDIDATE_DATA_{0}" -f $stamp)
$pm2Projector = Join-Path $CandidateRoot 'SCRIPTS\project_pm2_jlist.js'
$cutoverReport = Join-Path $env:TEMP ("MILES_PERMANENT_CUTOVER_{0}.json" -f $stamp)

function Normalize-Root([string]$PathValue) {
    return [System.IO.Path]::GetFullPath($PathValue).TrimEnd('\')
}

function Test-PathInsideRoot([string]$PathValue,[string]$RootValue) {
    if (-not $PathValue) { return $false }
    try {
        $path = Normalize-Root $PathValue
        $root = Normalize-Root $RootValue
        return $path.Equals($root,[System.StringComparison]::OrdinalIgnoreCase) -or
            $path.StartsWith($root + '\',[System.StringComparison]::OrdinalIgnoreCase)
    } catch { return $false }
}

function Get-Pm2Apps([string]$ProjectorPath) {
    if (-not (Get-Command pm2 -ErrorAction SilentlyContinue)) { throw 'pm2 command not found in PATH.' }
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'node command not found in PATH.' }
    if (-not (Test-Path -LiteralPath $ProjectorPath -PathType Leaf)) { throw "PM2 projector not found: $ProjectorPath" }

    $rawPath = Join-Path $env:TEMP ("MILES_PM2_JLIST_{0}.json" -f ([guid]::NewGuid().ToString('N')))
    try {
        $rawLines = @(& pm2 jlist 2>$null)
        if ($LASTEXITCODE -ne 0) { throw 'pm2 jlist failed.' }
        $raw = ($rawLines | ForEach-Object { [string]$_ }) -join "`n"
        if (-not $raw.Trim()) { throw 'pm2 jlist returned no data.' }
        [System.IO.File]::WriteAllText($rawPath,$raw,[System.Text.Encoding]::UTF8)
        $projected = @(& node $ProjectorPath $rawPath 2>$null)
        if ($LASTEXITCODE -ne 0) { throw 'Node PM2 projector failed.' }
        $apps = @()
        foreach ($line in $projected) {
            if (-not ([string]$line).Trim()) { continue }
            $parts = ([string]$line) -split "`t",6
            if ($parts.Count -ne 6) { throw "Invalid PM2 projection row: $line" }
            $apps += [pscustomobject]@{
                pid=if($parts[0]){[int]$parts[0]}else{0}
                pm_id=if($parts[1]){[int]$parts[1]}else{-1}
                name=[string]$parts[2]
                status=[string]$parts[3]
                pm_cwd=[string]$parts[4]
                pm_exec_path=[string]$parts[5]
            }
        }
        return @($apps)
    } finally {
        Remove-Item -LiteralPath $rawPath -Force -ErrorAction SilentlyContinue
    }
}

function Get-LiveRootPm2Apps([string]$ProjectorPath) {
    $selected = @()
    foreach ($app in @(Get-Pm2Apps $ProjectorPath)) {
        $cwd = [string]$app.pm_cwd
        $execPath = [string]$app.pm_exec_path
        if ((Test-PathInsideRoot $cwd $LiveRoot) -or (Test-PathInsideRoot $execPath $LiveRoot)) {
            $selected += [pscustomobject]@{
                pid=[int]$app.pid
                pm_id=[int]$app.pm_id
                name=[string]$app.name
                status=[string]$app.status
                cwd=$cwd
                exec_path=$execPath
                restore=[bool](([string]$app.status -eq 'online') -or ([int]$app.pid -gt 0))
            }
        }
    }
    return @($selected | Sort-Object pm_id -Unique)
}

function Get-PortOwners {
    $rows = @()
    foreach ($port in $ports) {
        foreach ($connection in @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)) {
            $rows += [pscustomobject]@{port=[int]$port;pid=[int]$connection.OwningProcess}
        }
    }
    return @($rows | Sort-Object port,pid -Unique)
}

function Stop-RootOwnedNodeProcesses([string[]]$Roots) {
    foreach ($row in @(Get-PortOwners)) {
        $proc = $null
        try { $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$($row.pid)" -ErrorAction Stop } catch {}
        if (-not $proc -or [string]$proc.Name -ine 'node.exe') { continue }
        $command = [string]$proc.CommandLine
        $owned = $false
        foreach ($root in $Roots) {
            if ($root -and $command -and $command.IndexOf((Normalize-Root $root),[System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
                $owned = $true
                break
            }
        }
        if ($owned) {
            try { Stop-Process -Id $row.pid -Force -ErrorAction Stop } catch {}
        }
    }
}

function Wait-Ports([bool]$Listening,[int]$Seconds) {
    $deadline = (Get-Date).AddSeconds($Seconds)
    do {
        $ownedPorts = @(Get-PortOwners | Select-Object -ExpandProperty port -Unique)
        if ($Listening -and $ownedPorts.Count -eq $ports.Count) { return }
        if (-not $Listening -and $ownedPorts.Count -eq 0) { return }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    $state = @(Get-PortOwners | ForEach-Object { "port=$($_.port) pid=$($_.pid)" }) -join '; '
    throw "Timed out waiting for canonical ports listening=$Listening. Current owners: $state"
}

function Get-ProductionAcceptance([string]$Root) {
    $audit = Join-Path $Root 'SCRIPTS\AUDIT_MILES_PRODUCTION_ACCEPTANCE.ps1'
    if (-not (Test-Path -LiteralPath $audit -PathType Leaf)) { throw "Production acceptance script missing: $audit" }
    $started = Get-Date
    & powershell -NoProfile -ExecutionPolicy Bypass -File $audit -Root $Root
    $dirs = @(Get-ChildItem -LiteralPath $env:TEMP -Directory -Filter 'MILES_PRODUCTION_ACCEPTANCE_*' -ErrorAction SilentlyContinue |
        Where-Object { $_.LastWriteTime -ge $started.AddSeconds(-2) } |
        Sort-Object LastWriteTime -Descending)
    if ($dirs.Count -eq 0) { throw 'Production acceptance report directory was not created.' }
    $jsonPath = Join-Path $dirs[0].FullName 'miles_production_acceptance.json'
    if (-not (Test-Path -LiteralPath $jsonPath -PathType Leaf)) { throw "Production acceptance JSON missing: $jsonPath" }
    $report = Get-Content -Raw -LiteralPath $jsonPath | ConvertFrom-Json
    return [pscustomobject]@{path=$jsonPath;report=$report}
}

if (-not (Test-Path -LiteralPath $LiveRoot -PathType Container)) { throw "Live root missing: $LiveRoot" }
if (-not (Test-Path -LiteralPath $CandidateRoot -PathType Container)) { throw "Candidate root missing: $CandidateRoot" }
if ((Normalize-Root $CandidateRoot) -eq (Normalize-Root $LiveRoot)) { throw 'CandidateRoot and LiveRoot must be different.' }
foreach ($reserved in @($rollbackRoot,$failedRoot,$candidateDataPark)) {
    if (Test-Path -LiteralPath $reserved) { throw "Reserved cutover path already exists: $reserved" }
}

$actualHead = [string]((& git -C $CandidateRoot rev-parse HEAD 2>$null) | Select-Object -First 1)
if ($LASTEXITCODE -ne 0 -or -not $actualHead) { throw 'Unable to resolve candidate HEAD.' }
$actualHead = $actualHead.Trim()
if ($actualHead -ne $ExpectedCommit) { throw "Candidate HEAD mismatch. Expected $ExpectedCommit, found $actualHead" }
if (-not (Test-Path -LiteralPath (Join-Path $CandidateRoot 'node_modules') -PathType Container)) { throw 'Candidate node_modules missing. Run npm ci before cutover.' }

$sourceChanges = @(& git -C $CandidateRoot diff --name-only HEAD -- API CORE SERVICES SCRIPTS CONNECTORS WORKERS '*.js' 'package.json' 'package-lock.json' 2>$null)
if ($LASTEXITCODE -ne 0) { throw 'Unable to verify candidate source integrity.' }
if ($sourceChanges.Count -gt 0) { throw "Candidate source/control files changed after validation: $($sourceChanges -join ', ')" }

$liveEnv = Join-Path $LiveRoot '.env'
$liveData = Join-Path $LiveRoot 'DATA'
if (-not (Test-Path -LiteralPath $liveEnv -PathType Leaf)) { throw "Live .env missing: $liveEnv" }
if (-not (Test-Path -LiteralPath $liveData -PathType Container)) { throw "Live DATA missing: $liveData" }

$pm2Apps = @(Get-LiveRootPm2Apps $pm2Projector)
if ($pm2Apps.Count -eq 0) { throw 'No PM2 entries were proven to belong to the live MILES root.' }
$restoreApps = @($pm2Apps | Where-Object { $_.restore })

$phase = 'PRECHECK'
$swapped = $false
$dataMoved = $false
$candidateDataParked = $false
$acceptance = $null
$rollbackSucceeded = $false
$cutoverSucceeded = $false
$errorText = ''

Write-Host '============================================================'
Write-Host 'MILES PERMANENT PRODUCTION CUTOVER'
Write-Host '============================================================'
Write-Host "Validated candidate: $CandidateRoot"
Write-Host "Current live root:   $LiveRoot"
Write-Host "Expected commit:     $ExpectedCommit"
Write-Host "Rollback root:       $rollbackRoot"
Write-Host "PM2 live-root entries: $($pm2Apps.Count); restore after cutover: $($restoreApps.Count)"
Write-Host 'Preserving live DATA by same-volume directory move; no robocopy.'
Write-Host 'Preserving live .env by direct file copy after root promotion.'
Write-Host 'Not overlaying live CONFIG or other deferred configuration trees.'

try {
    $phase = 'STOP_LIVE'
    foreach ($app in $pm2Apps) {
        & pm2 stop $app.pm_id | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "pm2 stop failed for id=$($app.pm_id) name=$($app.name)" }
    }
    Start-Sleep -Milliseconds 1000
    Stop-RootOwnedNodeProcesses @($LiveRoot,$CandidateRoot)
    Wait-Ports $false 30

    $phase = 'SWAP_ROOTS'
    Rename-Item -LiteralPath $LiveRoot -NewName (Split-Path -Leaf $rollbackRoot)
    Rename-Item -LiteralPath $CandidateRoot -NewName (Split-Path -Leaf $LiveRoot)
    $swapped = $true

    $phase = 'MIGRATE_STATE_ATOMIC'
    $newLiveData = Join-Path $LiveRoot 'DATA'
    $rollbackData = Join-Path $rollbackRoot 'DATA'
    if (Test-Path -LiteralPath $newLiveData -PathType Container) {
        Move-Item -LiteralPath $newLiveData -Destination $candidateDataPark
        $candidateDataParked = $true
    }
    if (-not (Test-Path -LiteralPath $rollbackData -PathType Container)) { throw "Rollback DATA missing after root swap: $rollbackData" }
    Move-Item -LiteralPath $rollbackData -Destination $newLiveData
    $dataMoved = $true

    $rollbackEnv = Join-Path $rollbackRoot '.env'
    $newLiveEnv = Join-Path $LiveRoot '.env'
    if (-not (Test-Path -LiteralPath $rollbackEnv -PathType Leaf)) { throw "Rollback .env missing after root swap: $rollbackEnv" }
    Copy-Item -LiteralPath $rollbackEnv -Destination $newLiveEnv -Force

    $phase = 'START_NEW_PRODUCTION'
    foreach ($app in $restoreApps) {
        & pm2 restart $app.pm_id | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "pm2 restart failed for id=$($app.pm_id) name=$($app.name)" }
    }
    Wait-Ports $true $TimeoutSeconds

    $phase = 'ACCEPT_NEW_PRODUCTION'
    $acceptance = Get-ProductionAcceptance $LiveRoot
    if (-not [bool]$acceptance.report.ready_for_daily_use) {
        $blockers = @($acceptance.report.hard_blockers) -join ', '
        throw "New production acceptance failed. Hard blockers: $blockers"
    }

    $phase = 'COMPLETE'
    $cutoverSucceeded = $true
}
catch {
    $errorText = $_.Exception.Message
    Write-Host "CUTOVER ERROR in phase $phase`: $errorText"
    if ($swapped) {
        Write-Host 'Automatic rollback starting...'
        try {
            foreach ($app in $pm2Apps) { & pm2 stop $app.pm_id | Out-Null }
            Start-Sleep -Milliseconds 750
            Stop-RootOwnedNodeProcesses @($LiveRoot,$rollbackRoot)
            try { Wait-Ports $false 30 } catch {}

            if ($dataMoved) {
                $currentLiveData = Join-Path $LiveRoot 'DATA'
                $rollbackData = Join-Path $rollbackRoot 'DATA'
                if (Test-Path -LiteralPath $rollbackData) { throw "Rollback DATA destination unexpectedly exists: $rollbackData" }
                if (-not (Test-Path -LiteralPath $currentLiveData -PathType Container)) { throw "Current live DATA missing during rollback: $currentLiveData" }
                Move-Item -LiteralPath $currentLiveData -Destination $rollbackData
                $dataMoved = $false
            }

            if (Test-Path -LiteralPath $failedRoot) { throw "Failed-root destination already exists: $failedRoot" }
            Rename-Item -LiteralPath $LiveRoot -NewName (Split-Path -Leaf $failedRoot)
            Rename-Item -LiteralPath $rollbackRoot -NewName (Split-Path -Leaf $LiveRoot)

            if ($candidateDataParked -and (Test-Path -LiteralPath $candidateDataPark -PathType Container)) {
                $failedData = Join-Path $failedRoot 'DATA'
                if (-not (Test-Path -LiteralPath $failedData)) {
                    Move-Item -LiteralPath $candidateDataPark -Destination $failedData
                }
            }

            foreach ($app in $restoreApps) {
                & pm2 restart $app.pm_id | Out-Null
                if ($LASTEXITCODE -ne 0) { throw "Rollback pm2 restart failed for id=$($app.pm_id) name=$($app.name)" }
            }
            Wait-Ports $true $TimeoutSeconds
            $rollbackSucceeded = $true
            Write-Host 'Automatic rollback completed successfully.'
        } catch {
            $rollbackSucceeded = $false
            Write-Host "ROLLBACK ERROR: $($_.Exception.Message)"
        }
    } else {
        foreach ($app in $restoreApps) {
            try { & pm2 restart $app.pm_id | Out-Null } catch {}
        }
        try { Wait-Ports $true $TimeoutSeconds; $rollbackSucceeded = $true } catch {}
    }
}
finally {
    $report = [ordered]@{
        generated_at=(Get-Date).ToUniversalTime().ToString('o')
        expected_commit=$ExpectedCommit
        live_root=$LiveRoot
        rollback_root=$rollbackRoot
        failed_root=if(Test-Path -LiteralPath $failedRoot){$failedRoot}else{''}
        candidate_data_park=if(Test-Path -LiteralPath $candidateDataPark){$candidateDataPark}else{''}
        phase=$phase
        cutover_succeeded=$cutoverSucceeded
        automatic_rollback_succeeded=$rollbackSucceeded
        pm2_entries=@($pm2Apps | ForEach-Object { [pscustomobject]@{pm_id=$_.pm_id;name=$_.name;restore=$_.restore} })
        acceptance_report=if($acceptance){$acceptance.path}else{''}
        acceptance_ready=if($acceptance){[bool]$acceptance.report.ready_for_daily_use}else{$false}
        error=$errorText
        config_overlay_performed=$false
        live_env_preserved=$true
        live_data_preserved=$true
        data_migration_mode='ATOMIC_SAME_VOLUME_DIRECTORY_MOVE'
    }
    $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $cutoverReport -Encoding UTF8
    Write-Host ''
    Write-Host "Permanent cutover succeeded: $cutoverSucceeded"
    Write-Host "New production acceptance ready: $(if($acceptance){[bool]$acceptance.report.ready_for_daily_use}else{$false})"
    Write-Host "Automatic rollback succeeded: $rollbackSucceeded"
    Write-Host "Rollback installation: $rollbackRoot"
    if (Test-Path -LiteralPath $candidateDataPark) { Write-Host "Candidate baseline DATA parked at: $candidateDataPark" }
    Write-Host "Cutover report: $cutoverReport"
}

if (-not $cutoverSucceeded) { exit 1 }
exit 0
