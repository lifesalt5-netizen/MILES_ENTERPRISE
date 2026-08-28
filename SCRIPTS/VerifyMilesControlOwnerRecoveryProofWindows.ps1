param(
    [string]$Root = "C:\P2GC_Intelligence\MILES_ENTERPRISE",
    [int]$MaxAgeMinutes = 30
)

$ErrorActionPreference = "Stop"
$ProcessName = "miles-autonomous-coo"
$WatchdogTaskName = "MILES-ControlOwner-Watchdog"
$ScheduleEvidencePath = Join-Path $Root "DATA\runtime\control_owner_recovery_proof_schedule_latest.json"
$ProofEvidencePath = Join-Path $Root "DATA\runtime\control_owner_recovery_proof_latest.json"

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
    $rows = $json | ConvertFrom-Json
    return @($rows | Where-Object { [string]$_.name -eq $Name } | Select-Object -First 1)[0]
}

try {
    if ($env:OS -ne "Windows_NT") { throw "WINDOWS_REQUIRED" }
    if (-not (Get-Command pm2.cmd -ErrorAction SilentlyContinue)) { throw "PM2_NOT_FOUND" }

    $schedule = Read-JsonRequired -Path $ScheduleEvidencePath -Code "RECOVERY_PROOF_SCHEDULE_EVIDENCE"
    $proof = Read-JsonRequired -Path $ProofEvidencePath -Code "RECOVERY_PROOF_EVIDENCE"

    if (-not [bool]$schedule.ok -or [string]$schedule.status -ne "CONTROL_OWNER_RECOVERY_PROOF_SCHEDULED") {
        throw "RECOVERY_PROOF_SCHEDULE_NOT_GREEN"
    }
    if (-not [bool]$proof.ok -or [string]$proof.status -ne "CONTROL_OWNER_WATCHDOG_RECOVERY_PROVEN") {
        throw "RECOVERY_PROOF_NOT_GREEN"
    }
    if ([string]::IsNullOrWhiteSpace([string]$schedule.proofId) -or [string]$schedule.proofId -ne [string]$proof.proofId) {
        throw "RECOVERY_PROOF_ID_MISMATCH"
    }

    $proofObserved = [datetime]::Parse([string]$proof.observedAt).ToUniversalTime()
    $ageMinutes = ((Get-Date).ToUniversalTime() - $proofObserved).TotalMinutes
    if ($ageMinutes -lt 0 -or $ageMinutes -gt $MaxAgeMinutes) {
        throw "RECOVERY_PROOF_STALE:$([math]::Round($ageMinutes,2))MIN"
    }

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

    $watchdogTask = Get-ScheduledTask -TaskName $WatchdogTaskName -ErrorAction Stop
    if (-not $watchdogTask -or [string]$watchdogTask.State -eq "Disabled") { throw "CONTROL_OWNER_WATCHDOG_NOT_ACTIVE_AFTER_PROOF" }

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
        watchdogTaskState = [string]$watchdogTask.State
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
