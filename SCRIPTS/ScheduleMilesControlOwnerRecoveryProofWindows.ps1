param(
    [string]$Root = "C:\P2GC_Intelligence\MILES_ENTERPRISE"
)

$ErrorActionPreference = "Stop"
$InstallEvidencePath = Join-Path $Root "DATA\runtime\control_owner_watchdog_install_latest.json"
$HeartbeatPath = Join-Path $Root "DATA\runtime\control_owner_watchdog_process_latest.json"
$RequestPath = Join-Path $Root "DATA\runtime\control_owner_recovery_proof_request.json"
$EvidencePath = Join-Path $Root "DATA\runtime\control_owner_recovery_proof_schedule_latest.json"
# Keep the controlled stop comfortably beyond the bridge's bounded evidence
# publication window so the schedule directive can publish COMPLETED first.
$DelaySeconds = 120
$RunnerDelaySeconds = 10

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

function Write-JsonAtomic {
    param([string]$Path,[object]$Payload)
    $parent = Split-Path -Parent $Path
    if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
    $temporary = "$Path.$PID.$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()).tmp"
    $Payload | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $temporary -Encoding UTF8
    try { Move-Item -LiteralPath $temporary -Destination $Path -Force }
    finally { if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue } }
}

function Write-ScheduleEvidence {
    param(
        [bool]$Ok,
        [string]$Status,
        [string]$ProofId = $null,
        [string]$ScheduledFor = $null,
        [string]$ErrorMessage = $null
    )
    $payload = [ordered]@{
        ok = $Ok
        status = $Status
        proofId = $ProofId
        launchMode = "INDEPENDENT_WATCHDOG_REQUEST"
        requestPath = $RequestPath
        delaySeconds = $DelaySeconds
        runnerDelaySeconds = $RunnerDelaySeconds
        scheduledFor = $ScheduledFor
        observedAt = (Get-Date).ToUniversalTime().ToString("o")
        error = $ErrorMessage
        safety = [ordered]@{
            oneShot = $true
            independentWatchdogOwnsProofLaunch = $true
            arbitraryShell = $false
            destructiveGitRecovery = $false
            providerMutation = $false
            sendsProspects = $false
            deletesEmail = $false
            changesDns = $false
            publishesB12 = $false
        }
    }
    Write-JsonAtomic -Path $EvidencePath -Payload $payload
    return $payload
}

try {
    if ($env:OS -ne "Windows_NT") { throw "WINDOWS_REQUIRED" }

    $install = Read-JsonSafe -Path $InstallEvidencePath
    $heartbeat = Read-JsonSafe -Path $HeartbeatPath
    if (-not (Test-WatchdogLive -InstallEvidence $install -Heartbeat $heartbeat)) {
        throw "CONTROL_OWNER_WATCHDOG_PROCESS_NOT_LIVE"
    }

    $existing = Read-JsonSafe -Path $RequestPath
    if ($existing) {
        $existingStatus = [string]$existing.status
        if (@("PENDING", "LAUNCHED") -contains $existingStatus.ToUpperInvariant()) {
            throw "RECOVERY_PROOF_REQUEST_ALREADY_ACTIVE:$([string]$existing.proofId)"
        }
    }

    $proofId = [guid]::NewGuid().ToString("N")
    $requestedAt = (Get-Date).ToUniversalTime()
    $notBefore = $requestedAt.AddSeconds($DelaySeconds)
    $request = [ordered]@{
        ok = $true
        status = "PENDING"
        proofId = $proofId
        requestedAt = $requestedAt.ToString("o")
        notBefore = $notBefore.ToString("o")
        runnerDelaySeconds = $RunnerDelaySeconds
        requestedBy = "CONTROL_OWNER_RECOVERY_PROOF_SCHEDULER"
        launchOwner = "INDEPENDENT_CONTROL_OWNER_WATCHDOG"
        safety = [ordered]@{
            oneShot = $true
            fixedRecoveryProofScriptOnly = $true
            arbitraryShell = $false
            destructiveGitRecovery = $false
            providerMutation = $false
            sendsProspects = $false
            deletesEmail = $false
            changesDns = $false
            publishesB12 = $false
        }
    }
    Write-JsonAtomic -Path $RequestPath -Payload $request

    $evidence = Write-ScheduleEvidence -Ok $true -Status "CONTROL_OWNER_RECOVERY_PROOF_SCHEDULED" -ProofId $proofId -ScheduledFor $notBefore.ToString("o")
    Write-Host "MILES_CONTROL_OWNER_RECOVERY_PROOF_SCHEDULED"
    Write-Host ($evidence | ConvertTo-Json -Compress -Depth 8)
    exit 0
}
catch {
    $message = $_.Exception.Message
    $evidence = Write-ScheduleEvidence -Ok $false -Status "CONTROL_OWNER_RECOVERY_PROOF_SCHEDULE_RED" -ErrorMessage $message
    Write-Error $message
    Write-Host ($evidence | ConvertTo-Json -Compress -Depth 8)
    exit 2
}
