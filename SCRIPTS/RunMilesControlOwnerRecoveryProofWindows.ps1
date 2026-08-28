param(
    [string]$Root = "C:\P2GC_Intelligence\MILES_ENTERPRISE",
    [Parameter(Mandatory=$true)][string]$ProofId,
    [int]$DelaySeconds = 45
)

$ErrorActionPreference = "Stop"
$ProcessName = "miles-autonomous-coo"
$Pm2ProbeScript = Join-Path $Root "SCRIPTS\GetMilesPm2ProcessStatus.js"
$InstallEvidencePath = Join-Path $Root "DATA\runtime\control_owner_watchdog_install_latest.json"
$HeartbeatPath = Join-Path $Root "DATA\runtime\control_owner_watchdog_process_latest.json"
$WatchdogEvidencePath = Join-Path $Root "DATA\runtime\control_owner_watchdog_latest.json"
$FailsafeScript = Join-Path $Root "SCRIPTS\RunMilesControlOwnerRecoveryFailsafeWindows.ps1"
$CancelMarker = Join-Path $Root ("DATA\runtime\control_owner_recovery_failsafe_cancel_" + $ProofId + ".json")
$EvidencePath = Join-Path $Root "DATA\runtime\control_owner_recovery_proof_latest.json"
$stoppedAt = $null
$failsafeArmed = $false
$failsafePid = $null

function Get-Pm2Process {
    param([string]$Name)
    $json = (& pm2.cmd jlist 2>$null) -join "`n"
    if ([string]::IsNullOrWhiteSpace($json)) { return $null }
    $probe = ($json | & node.exe $Pm2ProbeScript $Name 2>$null) -join "`n"
    if ($LASTEXITCODE -ne 0) { throw "PM2_JLIST_PARSE_FAILED" }
    $probe = [string]$probe
    $probe = $probe.Trim()
    if ($probe -eq "NOT_FOUND") { return $null }
    $prefix = "FOUND`t"
    if (-not $probe.StartsWith($prefix, [System.StringComparison]::Ordinal)) { throw "PM2_JLIST_PROBE_INVALID" }
    return [pscustomobject]@{
        name = $Name
        pm2_env = [pscustomobject]@{ status = $probe.Substring($prefix.Length) }
    }
}

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

function Write-ProofEvidence {
    param(
        [bool]$Ok,
        [string]$Status,
        [string]$ErrorMessage = $null,
        $WatchdogEvidence = $null,
        [string]$RecoveryObservedAt = $null
    )
    $parent = Split-Path -Parent $EvidencePath
    if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
    $payload = [ordered]@{
        ok = $Ok
        status = $Status
        proofId = $ProofId
        processName = $ProcessName
        watchdogMode = "USER_STARTUP_INDEPENDENT_PROCESS"
        delaySeconds = $DelaySeconds
        stoppedAt = if ($stoppedAt) { $stoppedAt.ToString("o") } else { $null }
        recoveryObservedAt = $RecoveryObservedAt
        observedAt = (Get-Date).ToUniversalTime().ToString("o")
        watchdogEvidence = $WatchdogEvidence
        failsafeArmed = $failsafeArmed
        failsafePid = $failsafePid
        error = $ErrorMessage
        safety = [ordered]@{
            controlledPm2StopOnly = $true
            recoveryMustComeFromIndependentWatchdog = $true
            arbitraryShell = $false
            gitMutation = $false
            destructiveGitRecovery = $false
            providerMutation = $false
            sendsProspects = $false
            deletesEmail = $false
            changesDns = $false
            publishesB12 = $false
        }
    }
    $payload | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $EvidencePath -Encoding UTF8
    return $payload
}

function Arm-Failsafe {
    if (-not (Test-Path -LiteralPath $FailsafeScript)) { throw "RECOVERY_FAILSAFE_SCRIPT_NOT_FOUND:$FailsafeScript" }
    $powershell = (Get-Command powershell.exe -ErrorAction Stop).Source
    $arguments = @(
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', ('"' + $FailsafeScript + '"'),
        '-Root', ('"' + $Root + '"'),
        '-ProofId', $ProofId,
        '-DelaySeconds', '300'
    )
    $process = Start-Process -FilePath $powershell -ArgumentList $arguments -WorkingDirectory $Root -WindowStyle Hidden -PassThru
    Start-Sleep -Seconds 1
    if (-not $process -or $process.HasExited) { throw "DETACHED_RECOVERY_FAILSAFE_LAUNCH_FAILED" }
    $script:failsafePid = [int]$process.Id
    $script:failsafeArmed = $true
}

function Disarm-Failsafe {
    $parent = Split-Path -Parent $CancelMarker
    if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
    [ordered]@{
        ok = $true
        proofId = $ProofId
        status = "PRIMARY_WATCHDOG_RECOVERED_CANCEL_FAILSAFE"
        observedAt = (Get-Date).ToUniversalTime().ToString("o")
    } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $CancelMarker -Encoding UTF8
    $script:failsafeArmed = $false
}

try {
    if ($env:OS -ne "Windows_NT") { throw "WINDOWS_REQUIRED" }
    if ($DelaySeconds -lt 10 -or $DelaySeconds -gt 180) { throw "RECOVERY_PROOF_DELAY_OUT_OF_RANGE" }
    if (-not (Test-Path -LiteralPath (Join-Path $Root ".git"))) { throw "MILES_ROOT_NOT_FOUND:$Root" }
    if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) { throw "NODE_NOT_FOUND" }
    if (-not (Test-Path -LiteralPath $Pm2ProbeScript)) { throw "PM2_STATUS_PROBE_NOT_FOUND:$Pm2ProbeScript" }
    if (-not (Get-Command pm2.cmd -ErrorAction SilentlyContinue)) { throw "PM2_NOT_FOUND" }

    if ($DelaySeconds -gt 0) { Start-Sleep -Seconds $DelaySeconds }

    $install = Read-JsonSafe -Path $InstallEvidencePath
    $heartbeat = Read-JsonSafe -Path $HeartbeatPath
    if (-not (Test-WatchdogLive -InstallEvidence $install -Heartbeat $heartbeat)) {
        throw "CONTROL_OWNER_WATCHDOG_PROCESS_NOT_LIVE_BEFORE_PROOF"
    }

    $before = Get-Pm2Process -Name $ProcessName
    if (-not $before -or [string]$before.pm2_env.status -ne "online") {
        throw "CONTROL_OWNER_NOT_ONLINE_BEFORE_PROOF"
    }

    Arm-Failsafe
    $stoppedAt = (Get-Date).ToUniversalTime()
    Write-ProofEvidence -Ok $false -Status "CONTROL_OWNER_RECOVERY_PROOF_STOPPING" | Out-Null

    & pm2.cmd stop $ProcessName | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "PM2_CONTROLLED_STOP_FAILED" }

    Start-Sleep -Seconds 2
    $deadline = (Get-Date).AddSeconds(180)
    $recovered = $false
    $matchedWatchdogEvidence = $null
    $recoveryObservedAt = $null

    while ((Get-Date) -lt $deadline) {
        $owner = Get-Pm2Process -Name $ProcessName
        $watchdogEvidence = Read-JsonSafe -Path $WatchdogEvidencePath
        $watchdogObserved = $null
        if ($watchdogEvidence -and $watchdogEvidence.observedAt) {
            try { $watchdogObserved = [datetime]::Parse([string]$watchdogEvidence.observedAt).ToUniversalTime() } catch {}
        }

        $freshRecoveryEvidence = $watchdogEvidence -and
            [bool]$watchdogEvidence.ok -and
            [string]$watchdogEvidence.status -eq "CONTROL_OWNER_RECOVERED" -and
            @("PM2_RESTART", "PM2_GUARDED_START") -contains [string]$watchdogEvidence.action -and
            $watchdogObserved -and
            $watchdogObserved -gt $stoppedAt

        if ($owner -and [string]$owner.pm2_env.status -eq "online" -and $freshRecoveryEvidence) {
            $recovered = $true
            $matchedWatchdogEvidence = $watchdogEvidence
            $recoveryObservedAt = (Get-Date).ToUniversalTime().ToString("o")
            break
        }
        Start-Sleep -Seconds 5
    }

    if (-not $recovered) {
        throw "INDEPENDENT_WATCHDOG_DID_NOT_PROVE_RECOVERY_WITHIN_180_SECONDS_FAILSAFE_LEFT_ARMED"
    }

    Disarm-Failsafe
    $evidence = Write-ProofEvidence -Ok $true -Status "CONTROL_OWNER_WATCHDOG_RECOVERY_PROVEN" -WatchdogEvidence $matchedWatchdogEvidence -RecoveryObservedAt $recoveryObservedAt
    Write-Host "MILES_CONTROL_OWNER_WATCHDOG_RECOVERY_PROVEN"
    Write-Host ($evidence | ConvertTo-Json -Compress -Depth 8)
    exit 0
}
catch {
    $message = $_.Exception.Message
    $evidence = Write-ProofEvidence -Ok $false -Status "CONTROL_OWNER_WATCHDOG_RECOVERY_PROOF_RED" -ErrorMessage $message
    Write-Error $message
    Write-Host ($evidence | ConvertTo-Json -Compress -Depth 8)
    exit 2
}
