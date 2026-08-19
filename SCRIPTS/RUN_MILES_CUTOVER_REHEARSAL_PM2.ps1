param(
    [Parameter(Mandatory=$true)][string]$CandidateRoot,
    [string]$LiveRoot = "C:\P2GC_Intelligence\MILES_ENTERPRISE",
    [Parameter(Mandatory=$true)][string]$ExpectedCommit,
    [int]$TimeoutSeconds = 120
)

$ErrorActionPreference = "Stop"
$ports = @(3000,8787,3737,8737)

function Get-Pm2Apps {
    $raw = (& pm2 jlist 2>$null | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or -not $raw) { throw "pm2 jlist failed or returned no data." }
    try { return @($raw | ConvertFrom-Json) }
    catch { throw "Unable to parse pm2 jlist JSON: $($_.Exception.Message)" }
}

function Test-LiveRootApp($App) {
    $cwd = [string]$App.pm2_env.pm_cwd
    $exec = [string]$App.pm2_env.pm_exec_path
    $root = [System.IO.Path]::GetFullPath($LiveRoot).TrimEnd('\\')
    if ($cwd) {
        try { if ([System.IO.Path]::GetFullPath($cwd).TrimEnd('\\') -ieq $root) { return $true } } catch {}
    }
    if ($exec) {
        try {
            $fullExec = [System.IO.Path]::GetFullPath($exec)
            if ($fullExec.StartsWith($root + '\\',[System.StringComparison]::OrdinalIgnoreCase)) { return $true }
        } catch {}
    }
    return $false
}

function Get-PortState {
    $rows = @()
    foreach ($port in $ports) {
        $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
        $rows += [pscustomobject]@{
            port = $port
            listening = ($listeners.Count -gt 0)
            pids = @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)
        }
    }
    return $rows
}

function Wait-Ports([bool]$Listening,[int]$TimeoutSec) {
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    do {
        $rows = @(Get-PortState)
        if (@($rows | Where-Object { $_.listening -eq $Listening }).Count -eq $ports.Count) { return $rows }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    $rows = @(Get-PortState)
    $detail = ($rows | ForEach-Object { "port=$($_.port) listening=$($_.listening) pids=$(@($_.pids) -join ',')" }) -join '; '
    throw "Timed out waiting for ports listening=$Listening. $detail"
}

function Wait-Pm2Online([string[]]$Names,[int]$TimeoutSec) {
    if ($Names.Count -eq 0) { return $true }
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    do {
        $apps = @(Get-Pm2Apps)
        $online = @($apps | Where-Object { $Names -contains [string]$_.name -and [string]$_.pm2_env.status -eq 'online' } | ForEach-Object { [string]$_.name })
        if (@($Names | Where-Object { $online -notcontains $_ }).Count -eq 0) { return $true }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    return $false
}

if (-not (Get-Command pm2 -ErrorAction SilentlyContinue)) { throw "pm2 command not found." }
if (-not (Test-Path -LiteralPath $CandidateRoot -PathType Container)) { throw "Candidate root not found: $CandidateRoot" }
if (-not (Test-Path -LiteralPath $LiveRoot -PathType Container)) { throw "Live root not found: $LiveRoot" }

$actualHead = [string]((& git -C $CandidateRoot rev-parse HEAD 2>$null) | Select-Object -First 1)
if ($LASTEXITCODE -ne 0 -or -not $actualHead) { throw "Unable to resolve candidate HEAD." }
$actualHead = $actualHead.Trim()
if ($actualHead -ne $ExpectedCommit) { throw "Candidate HEAD mismatch. Expected $ExpectedCommit, found $actualHead" }

$status = @(& git -C $CandidateRoot status --porcelain=v1 --untracked-files=all 2>$null)
if ($LASTEXITCODE -ne 0) { throw "Unable to inspect candidate Git status." }
if ($status.Count -ne 0) { throw "Candidate must be clean before rehearsal. Found $($status.Count) status entries." }

$windowsRunner = Join-Path $CandidateRoot 'SCRIPTS\RUN_MILES_CUTOVER_REHEARSAL_WINDOWS.ps1'
if (-not (Test-Path -LiteralPath $windowsRunner -PathType Leaf)) { throw "Windows rehearsal runner missing: $windowsRunner" }

$initialApps = @(Get-Pm2Apps)
$liveApps = @($initialApps | Where-Object { Test-LiveRootApp $_ })
if ($liveApps.Count -eq 0) { throw "No PM2 apps rooted in live MILES directory were found." }
$onlineNames = @($liveApps | Where-Object { [string]$_.pm2_env.status -eq 'online' } | ForEach-Object { [string]$_.name })

$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$outDir = Join-Path $env:TEMP "MILES_PM2_CUTOVER_REHEARSAL_$stamp"
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
$reportPath = Join-Path $outDir 'miles_pm2_cutover_rehearsal.json'
$innerOutput = Join-Path $outDir 'inner_rehearsal_output.txt'

$innerExit = 1
$portsClosed = $false
$pm2Restored = $false
$portsRestored = $false
$failure = $null

Write-Host '============================================================'
Write-Host 'MILES PM2-AWARE CONTROLLED CUTOVER REHEARSAL'
Write-Host '============================================================'
Write-Host "Candidate: $CandidateRoot"
Write-Host "Live:      $LiveRoot"
Write-Host "Commit:    $ExpectedCommit"
Write-Host "PM2 live-root apps found: $($liveApps.Count)"
Write-Host "PM2 apps currently online: $($onlineNames.Count)"
foreach ($name in $onlineNames) { Write-Host "  ONLINE: $name" }
Write-Host 'Safety: only PM2 apps whose cwd/script resolves inside the live MILES root are stopped.'
Write-Host 'Candidate remains zero-execution and Instantly/controlled writes remain disabled.'

try {
    Write-Host ''
    Write-Host 'Stopping live-root PM2 apps...'
    foreach ($name in $onlineNames) {
        & pm2 stop $name 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "pm2 stop failed for $name" }
    }

    Wait-Ports $false 30 | Out-Null
    $portsClosed = $true

    Write-Host 'Canonical ports are free. Starting zero-execution candidate rehearsal...'
    $output = & powershell -NoProfile -ExecutionPolicy Bypass `
        -File $windowsRunner `
        -CandidateRoot $CandidateRoot `
        -LiveRoot $LiveRoot `
        -ExpectedCommit $ExpectedCommit `
        -TimeoutSeconds $TimeoutSeconds 2>&1
    $innerExit = $LASTEXITCODE
    @($output | ForEach-Object { [string]$_ }) | Set-Content -LiteralPath $innerOutput -Encoding UTF8
    $output | ForEach-Object { Write-Host ([string]$_) }
    if ($innerExit -ne 0) { throw "Inner zero-execution rehearsal failed with exit code $innerExit" }
}
catch {
    $failure = $_.Exception.Message
}
finally {
    Write-Host ''
    Write-Host 'Restoring original PM2 online set...'
    foreach ($name in $onlineNames) {
        try { & pm2 start $name 2>&1 | Out-Null } catch {}
    }

    try { $pm2Restored = Wait-Pm2Online $onlineNames $TimeoutSeconds } catch { $pm2Restored = $false }
    try {
        Wait-Ports $true $TimeoutSeconds | Out-Null
        $portsRestored = $true
    } catch { $portsRestored = $false }

    if (-not $pm2Restored -and -not $failure) { $failure = 'PM2_RESTORE_NOT_FULLY_ONLINE' }
    if (-not $portsRestored -and -not $failure) { $failure = 'CANONICAL_PORTS_NOT_RESTORED' }
}

$passed = ($portsClosed -and $innerExit -eq 0 -and $pm2Restored -and $portsRestored -and -not $failure)
$report = [ordered]@{
    generated_at = (Get-Date).ToUniversalTime().ToString('o')
    rehearsal = 'MILES_PM2_AWARE_CONTROLLED_CUTOVER_REHEARSAL'
    candidate_root = $CandidateRoot
    live_root = $LiveRoot
    expected_commit = $ExpectedCommit
    candidate_head = $actualHead
    pm2_live_root_apps = @($liveApps | ForEach-Object { [ordered]@{ name=[string]$_.name; pm_id=$_.pm_id; status=[string]$_.pm2_env.status; cwd=[string]$_.pm2_env.pm_cwd; script=[string]$_.pm2_env.pm_exec_path } })
    original_online_names = $onlineNames
    canonical_ports_freed = $portsClosed
    inner_rehearsal_exit_code = $innerExit
    original_pm2_online_set_restored = $pm2Restored
    canonical_ports_restored = $portsRestored
    failure = $failure
    safety = [ordered]@{
        pm2_delete_used = $false
        unrelated_pm2_apps_stopped = $false
        candidate_worker_execution_enabled = $false
        candidate_autonomous_work_generation_enabled = $false
        candidate_workflow_queueing_enabled = $false
        candidate_controlled_writes_enabled = $false
        candidate_instantly_writes_enabled = $false
        production_source_files_migrated = $false
    }
    rehearsal_passed = $passed
    evidence = [ordered]@{ inner_rehearsal_output=$innerOutput }
}
$report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $reportPath -Encoding UTF8

Write-Host ''
Write-Host "Canonical ports freed: $portsClosed"
Write-Host "Candidate rehearsal exit: $innerExit"
Write-Host "Original PM2 online set restored: $pm2Restored"
Write-Host "Canonical ports restored: $portsRestored"
Write-Host "PM2-aware rehearsal passed: $passed"
if ($failure) { Write-Host "Failure: $failure" }
Write-Host "Report: $reportPath"

if (-not $passed) { exit 1 }
exit 0
