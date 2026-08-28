param(
    [string]$Root = "C:\P2GC_Intelligence\MILES_ENTERPRISE",
    [Parameter(Mandatory=$true)][string]$ProofId
)

$ErrorActionPreference = "Stop"
$ProcessName = "miles-autonomous-coo"
$WatchdogTaskName = "MILES-ControlOwner-Watchdog"
$FailsafeTaskName = "MILES-ControlOwner-Recovery-Proof-Failsafe"
$EnsureScript = Join-Path $Root "SCRIPTS\EnsureMilesControlOwnerWindows.ps1"
$WatchdogEvidencePath = Join-Path $Root "DATA\runtime\control_owner_watchdog_latest.json"
$EvidencePath = Join-Path $Root "DATA\runtime\control_owner_recovery_proof_latest.json"
$stoppedAt = $null
$failsafeArmed = $false

function Get-Pm2Process {
    param([string]$Name)
    $json = (& pm2.cmd jlist 2>$null) -join "`n"
    if ([string]::IsNullOrWhiteSpace($json)) { return $null }
    $rows = $json | ConvertFrom-Json
    return @($rows | Where-Object { [string]$_.name -eq $Name } | Select-Object -First 1)[0]
}

function Read-JsonSafe {
    param([string]$Path)
    try {
        if (-not (Test-Path -LiteralPath $Path)) { return $null }
        return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
    }
    catch { return $null }
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
    if (-not (Test-Path -LiteralPath $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }

    $payload = [ordered]@{
        ok = $Ok
        status = $Status
        proofId = $ProofId
        processName = $ProcessName
        watchdogTaskName = $WatchdogTaskName
        stoppedAt = if ($stoppedAt) { $stoppedAt.ToString("o") } else { $null }
        recoveryObservedAt = $RecoveryObservedAt
        observedAt = (Get-Date).ToUniversalTime().ToString("o")
        watchdogEvidence = $WatchdogEvidence
        failsafeArmed = $failsafeArmed
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
    $powershell = (Get-Command powershell.exe -ErrorAction Stop).Source
    $escapedRoot = $Root.Replace('"', '""')
    $escapedEnsure = $EnsureScript.Replace('"', '""')
    $arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$escapedEnsure`" -Root `"$escapedRoot`""
    $action = New-ScheduledTaskAction -Execute $powershell -Argument $arguments -WorkingDirectory $Root
    $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5)
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
    $userId = if ($env:USERDOMAIN) { "$($env:USERDOMAIN)\$($env:USERNAME)" } else { $env:USERNAME }
    $principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
    $task = New-ScheduledTask -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description "Fail-safe recovery only if the primary MILES control-owner watchdog proof does not recover the owner."
    Register-ScheduledTask -TaskName $FailsafeTaskName -InputObject $task -Force | Out-Null
    $script:failsafeArmed = $true
}

function Disarm-Failsafe {
    try {
        Unregister-ScheduledTask -TaskName $FailsafeTaskName -Confirm:$false -ErrorAction SilentlyContinue
        $script:failsafeArmed = $false
    } catch {}
}

try {
    if ($env:OS -ne "Windows_NT") { throw "WINDOWS_REQUIRED" }
    if (-not (Test-Path -LiteralPath (Join-Path $Root ".git"))) { throw "MILES_ROOT_NOT_FOUND:$Root" }
    if (-not (Test-Path -LiteralPath $EnsureScript)) { throw "WATCHDOG_ENSURE_SCRIPT_NOT_FOUND:$EnsureScript" }
    if (-not (Get-Command pm2.cmd -ErrorAction SilentlyContinue)) { throw "PM2_NOT_FOUND" }

    $watchdogTask = Get-ScheduledTask -TaskName $WatchdogTaskName -ErrorAction Stop
    if (-not $watchdogTask) { throw "CONTROL_OWNER_WATCHDOG_NOT_INSTALLED" }
    if ([string]$watchdogTask.State -eq "Disabled") { throw "CONTROL_OWNER_WATCHDOG_DISABLED" }

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
