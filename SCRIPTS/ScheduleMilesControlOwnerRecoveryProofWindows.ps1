param(
    [string]$Root = "C:\P2GC_Intelligence\MILES_ENTERPRISE"
)

$ErrorActionPreference = "Stop"
$ProofScript = Join-Path $Root "SCRIPTS\RunMilesControlOwnerRecoveryProofWindows.ps1"
$DetachedLauncher = Join-Path $Root "SCRIPTS\LaunchMilesControlOwnerRecoveryProof.js"
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
    if (-not (Test-Path -LiteralPath $DetachedLauncher)) { throw "RECOVERY_PROOF_DETACHED_LAUNCHER_NOT_FOUND:$DetachedLauncher" }
    if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) { throw "NODE_NOT_FOUND" }
    & node.exe --check $DetachedLauncher | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "RECOVERY_PROOF_DETACHED_LAUNCHER_NODE_CHECK_FAILED" }

    $install = Read-JsonSafe -Path $InstallEvidencePath
    $heartbeat = Read-JsonSafe -Path $HeartbeatPath
    if (-not (Test-WatchdogLive -InstallEvidence $install -Heartbeat $heartbeat)) {
        throw "CONTROL_OWNER_WATCHDOG_PROCESS_NOT_LIVE"
    }

    $proofId = [guid]::NewGuid().ToString("N")
    $launchOutput = (& node.exe $DetachedLauncher --root $Root --proof-id $proofId --delay-seconds $DelaySeconds 2>&1) -join "`n"
    if ($LASTEXITCODE -ne 0) { throw "DETACHED_RECOVERY_PROOF_LAUNCH_FAILED:$launchOutput" }
    $match = [regex]::Match([string]$launchOutput, 'RECOVERY_PROOF_LAUNCH_PID=(\d+)')
    if (-not $match.Success) { throw "DETACHED_RECOVERY_PROOF_PID_NOT_RETURNED" }
    $launcherPid = [int]$match.Groups[1].Value

    $evidence = Write-ScheduleEvidence -Ok $true -Status "CONTROL_OWNER_RECOVERY_PROOF_SCHEDULED" -ProofId $proofId -LauncherPid $launcherPid
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
