param(
    [string]$Root = "C:\P2GC_Intelligence\MILES_ENTERPRISE",
    [int]$MaxAgeMinutes = 30
)

$ErrorActionPreference = "Stop"
$ProcessName = "miles-autonomous-coo"
$Pm2ProbeScript = Join-Path $Root "SCRIPTS\GetMilesPm2ProcessStatus.js"
$ScheduleEvidencePath = Join-Path $Root "DATA\runtime\control_owner_recovery_proof_schedule_latest.json"
$ProofEvidencePath = Join-Path $Root "DATA\runtime\control_owner_recovery_proof_latest.json"
$InstallEvidencePath = Join-Path $Root "DATA\runtime\control_owner_watchdog_install_latest.json"
$HeartbeatPath = Join-Path $Root "DATA\runtime\control_owner_watchdog_process_latest.json"

function Read-JsonRequired {
    param([string]$Path, [string]$Code)
    if (-not (Test-Path -LiteralPath $Path)) { throw "$Code`_MISSING:$Path" }
    try { return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json }
    catch { throw "$Code`_INVALID_JSON:$Path" }
}

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

try {
    if ($env:OS -ne "Windows_NT") { throw "WINDOWS_REQUIRED" }
    if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) { throw "NODE_NOT_FOUND" }
    if (-not (Test-Path -LiteralPath $Pm2ProbeScript)) { throw "PM2_STATUS_PROBE_NOT_FOUND:$Pm2ProbeScript" }
    if (-not (Get-Command pm2.cmd -ErrorAction SilentlyContinue)) { throw "PM2_NOT_FOUND" }

    $schedule = Read-JsonRequired -Path $ScheduleEvidencePath -Code "RECOVERY_PROOF_SCHEDULE_EVIDENCE"
    $proof = Read-JsonRequired -Path $ProofEvidencePath -Code "RECOVERY_PROOF_EVIDENCE"
    $install = Read-JsonRequired -Path $InstallEvidencePath -Code "WATCHDOG_INSTALL_EVIDENCE"
    $heartbeat = Read-JsonRequired -Path $HeartbeatPath -Code "WATCHDOG_PROCESS_HEARTBEAT"

    if (-not [bool]$schedule.ok -or [string]$schedule.status -ne "CONTROL_OWNER_RECOVERY_PROOF_SCHEDULED") { throw "RECOVERY_PROOF_SCHEDULE_NOT_GREEN" }
    if ([string]$schedule.launchMode -ne "DETACHED_FIXED_PROCESS") { throw "RECOVERY_PROOF_SCHEDULE_MODE_INVALID" }
    if (-not [bool]$proof.ok -or [string]$proof.status -ne "CONTROL_OWNER_WATCHDOG_RECOVERY_PROVEN") { throw "RECOVERY_PROOF_NOT_GREEN" }
    if ([string]$proof.watchdogMode -ne "USER_STARTUP_INDEPENDENT_PROCESS") { throw "RECOVERY_PROOF_WATCHDOG_MODE_INVALID" }
    if ([string]::IsNullOrWhiteSpace([string]$schedule.proofId) -or [string]$schedule.proofId -ne [string]$proof.proofId) { throw "RECOVERY_PROOF_ID_MISMATCH" }

    if (-not [bool]$install.ok -or [string]$install.status -ne "CONTROL_OWNER_WATCHDOG_INSTALLED") { throw "CONTROL_OWNER_WATCHDOG_INSTALL_NOT_GREEN" }
    if ([string]$install.mode -ne "USER_STARTUP_INDEPENDENT_PROCESS") { throw "CONTROL_OWNER_WATCHDOG_INSTALL_MODE_INVALID" }
    if (-not $install.startupShortcut -or -not (Test-Path -LiteralPath ([string]$install.startupShortcut))) { throw "CONTROL_OWNER_WATCHDOG_STARTUP_SHORTCUT_MISSING" }

    $heartbeatObserved = [datetime]::Parse([string]$heartbeat.observedAt).ToUniversalTime()
    $heartbeatAgeSeconds = ((Get-Date).ToUniversalTime() - $heartbeatObserved).TotalSeconds
    if ($heartbeatAgeSeconds -lt 0 -or $heartbeatAgeSeconds -gt 180) { throw "CONTROL_OWNER_WATCHDOG_HEARTBEAT_STALE" }
    $watchdogProcess = Get-Process -Id ([int]$heartbeat.pid) -ErrorAction SilentlyContinue
    if (-not $watchdogProcess) { throw "CONTROL_OWNER_WATCHDOG_PROCESS_NOT_RUNNING" }

    $proofObserved = [datetime]::Parse([string]$proof.observedAt).ToUniversalTime()
    $ageMinutes = ((Get-Date).ToUniversalTime() - $proofObserved).TotalMinutes
    if ($ageMinutes -lt 0 -or $ageMinutes -gt $MaxAgeMinutes) { throw "RECOVERY_PROOF_STALE:$([math]::Round($ageMinutes,2))MIN" }

    if (-not $proof.stoppedAt -or -not $proof.recoveryObservedAt) { throw "RECOVERY_PROOF_TIMESTAMPS_MISSING" }
    $stoppedAt = [datetime]::Parse([string]$proof.stoppedAt).ToUniversalTime()
    $recoveredAt = [datetime]::Parse([string]$proof.recoveryObservedAt).ToUniversalTime()
    if ($recoveredAt -le $stoppedAt) { throw "RECOVERY_PROOF_TIMESTAMP_ORDER_INVALID" }

    $watchdogEvidence = $proof.watchdogEvidence
    if (-not $watchdogEvidence -or -not [bool]$watchdogEvidence.ok) { throw "RECOVERY_PROOF_WATCHDOG_EVIDENCE_MISSING" }
    if ([string]$watchdogEvidence.status -ne "CONTROL_OWNER_RECOVERED") { throw "RECOVERY_PROOF_WATCHDOG_STATUS_INVALID" }
    if (@("PM2_RESTART", "PM2_GUARDED_START") -notcontains [string]$watchdogEvidence.action) { throw "RECOVERY_PROOF_WATCHDOG_ACTION_INVALID" }
    $watchdogObserved = [datetime]::Parse([string]$watchdogEvidence.observedAt).ToUniversalTime()
    if ($watchdogObserved -le $stoppedAt) { throw "RECOVERY_PROOF_WATCHDOG_EVIDENCE_NOT_POST_STOP" }

    $owner = Get-Pm2Process -Name $ProcessName
    if (-not $owner -or [string]$owner.pm2_env.status -ne "online") { throw "CONTROL_OWNER_NOT_ONLINE_AFTER_PROOF" }

    $result = [ordered]@{
        ok = $true
        status = "CONTROL_OWNER_WATCHDOG_RECOVERY_VERIFIED"
        proofId = [string]$proof.proofId
        stoppedAt = $stoppedAt.ToString("o")
        watchdogRecoveredAt = $watchdogObserved.ToString("o")
        recoveryObservedAt = $recoveredAt.ToString("o")
        proofAgeMinutes = [math]::Round($ageMinutes, 2)
        ownerStatus = [string]$owner.pm2_env.status
        watchdogMode = [string]$install.mode
        watchdogPid = [int]$heartbeat.pid
        watchdogHeartbeatAgeSeconds = [math]::Round($heartbeatAgeSeconds, 2)
        startupShortcut = [string]$install.startupShortcut
        observedAt = (Get-Date).ToUniversalTime().ToString("o")
        readOnlyVerification = $true
    }

    Write-Host "MILES_CONTROL_OWNER_WATCHDOG_RECOVERY_VERIFIED"
    Write-Host ($result | ConvertTo-Json -Compress -Depth 6)
    exit 0
}
catch {
    Write-Error $_.Exception.Message
    Write-Host "MILES_CONTROL_OWNER_WATCHDOG_RECOVERY_VERIFY_RED"
    exit 2
}
