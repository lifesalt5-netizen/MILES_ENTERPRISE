param(
    [string]$Root = "C:\P2GC_Intelligence\MILES_ENTERPRISE"
)

$ErrorActionPreference = "Stop"
$ProofScript = Join-Path $Root "SCRIPTS\RunMilesControlOwnerRecoveryProofWindows.ps1"
$InstallEvidencePath = Join-Path $Root "DATA\runtime\control_owner_watchdog_install_latest.json"
$HeartbeatPath = Join-Path $Root "DATA\runtime\control_owner_watchdog_process_latest.json"
$EvidencePath = Join-Path $Root "DATA\runtime\control_owner_recovery_proof_schedule_latest.json"
$DelaySeconds = 45

function Read-JsonSafe {
    param([string]$Path)
    try {
        if (-not (Test-Path -LiteralPath $Path)) { return $null }
        return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
    }
    catch { return $null }
}

function Test-WatchdogLive {
    param($InstallEvidence, $Heartbeat, [int]$MaxAgeSeconds = 180)
    if (-not $InstallEvidence -or -not [bool]$InstallEvidence.ok) { return $false }
    if ([string]$InstallEvidence.status -ne "CONTROL_OWNER_WATCHDOG_INSTALLED") { return $false }
    if ([string]$InstallEvidence.mode -ne "USER_STARTUP_INDEPENDENT_PROCESS") { return $false }
    if (-not $InstallEvidence.startupShortcut -or -not (Test-Path -LiteralPath ([string]$InstallEvidence.startupShortcut))) { return $false }
    if (-not $Heartbeat -or -not $Heartbeat.observedAt -or -not $Heartbeat.pid) { return $false }
    try {
        $observed = [datetime]::Parse([string]$Heartbeat.observedAt).ToUniversalTime()
        $age = ((Get-Date).ToUniversalTime() - $observed).TotalSeconds
        if ($age -lt 0 -or $age -gt $MaxAgeSeconds) { return $false }
        return [bool](Get-Process -Id ([int]$Heartbeat.pid) -ErrorAction SilentlyContinue)
    }
    catch { return $false }
}

function Write-ScheduleEvidence {
    param(
        [bool]$Ok,
        [string]$Status,
        [string]$ProofId = $null,
        [Nullable[int]]$LauncherPid = $null,
        [string]$ErrorMessage = $null
    )
    $parent = Split-Path -Parent $EvidencePath
    if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
    $payload = [ordered]@{
        ok = $Ok
        status = $Status
        proofId = $ProofId
        launcherPid = $LauncherPid
        launchMode = "DETACHED_FIXED_PROCESS"
        delaySeconds = $DelaySeconds
        scheduledFor = if ($Ok) { (Get-Date).AddSeconds($DelaySeconds).ToUniversalTime().ToString("o") } else { $null }
        observedAt = (Get-Date).ToUniversalTime().ToString("o")
        error = $ErrorMessage
        safety = [ordered]@{
            oneShot = $true
            arbitraryShell = $false
            destructiveGitRecovery = $false
            providerMutation = $false
            sendsProspects = $false
            deletesEmail = $false
            changesDns = $false
            publishesB12 = $false
        }
    }
    $payload | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $EvidencePath -Encoding UTF8
    return $payload
}

try {
    if ($env:OS -ne "Windows_NT") { throw "WINDOWS_REQUIRED" }
    if (-not (Test-Path -LiteralPath $ProofScript)) { throw "RECOVERY_PROOF_SCRIPT_NOT_FOUND:$ProofScript" }

    $install = Read-JsonSafe -Path $InstallEvidencePath
    $heartbeat = Read-JsonSafe -Path $HeartbeatPath
    if (-not (Test-WatchdogLive -InstallEvidence $install -Heartbeat $heartbeat)) {
        throw "CONTROL_OWNER_WATCHDOG_PROCESS_NOT_LIVE"
    }

    $proofId = [guid]::NewGuid().ToString("N")
    $powershell = (Get-Command powershell.exe -ErrorAction Stop).Source
    $arguments = @(
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', ('"' + $ProofScript + '"'),
        '-Root', ('"' + $Root + '"'),
        '-ProofId', $proofId,
        '-DelaySeconds', [string]$DelaySeconds
    )
    $launcher = Start-Process -FilePath $powershell -ArgumentList $arguments -WorkingDirectory $Root -WindowStyle Hidden -PassThru
    Start-Sleep -Seconds 1
    if (-not $launcher -or $launcher.HasExited) { throw "DETACHED_RECOVERY_PROOF_LAUNCH_FAILED" }

    $evidence = Write-ScheduleEvidence -Ok $true -Status "CONTROL_OWNER_RECOVERY_PROOF_SCHEDULED" -ProofId $proofId -LauncherPid ([int]$launcher.Id)
    Write-Host "MILES_CONTROL_OWNER_RECOVERY_PROOF_SCHEDULED"
    Write-Host ($evidence | ConvertTo-Json -Compress -Depth 6)
    exit 0
}
catch {
    $message = $_.Exception.Message
    $evidence = Write-ScheduleEvidence -Ok $false -Status "CONTROL_OWNER_RECOVERY_PROOF_SCHEDULE_RED" -ErrorMessage $message
    Write-Error $message
    Write-Host ($evidence | ConvertTo-Json -Compress -Depth 6)
    exit 2
}
