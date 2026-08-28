param(
    [string]$Root = "C:\P2GC_Intelligence\MILES_ENTERPRISE",
    [string]$TaskName = "MILES-ControlOwner-Recovery-Proof"
)

$ErrorActionPreference = "Stop"
$WatchdogTaskName = "MILES-ControlOwner-Watchdog"
$ProofScript = Join-Path $Root "SCRIPTS\RunMilesControlOwnerRecoveryProofWindows.ps1"
$EvidencePath = Join-Path $Root "DATA\runtime\control_owner_recovery_proof_schedule_latest.json"

function Write-ScheduleEvidence {
    param(
        [bool]$Ok,
        [string]$Status,
        [string]$ProofId = $null,
        [Nullable[datetime]]$ScheduledFor = $null,
        [string]$ErrorMessage = $null
    )

    $parent = Split-Path -Parent $EvidencePath
    if (-not (Test-Path -LiteralPath $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }

    $payload = [ordered]@{
        ok = $Ok
        status = $Status
        proofId = $ProofId
        taskName = $TaskName
        watchdogTaskName = $WatchdogTaskName
        scheduledFor = if ($ScheduledFor) { $ScheduledFor.Value.ToUniversalTime().ToString("o") } else { $null }
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

    $watchdogTask = Get-ScheduledTask -TaskName $WatchdogTaskName -ErrorAction Stop
    if (-not $watchdogTask) { throw "CONTROL_OWNER_WATCHDOG_NOT_INSTALLED" }
    if ([string]$watchdogTask.State -eq "Disabled") { throw "CONTROL_OWNER_WATCHDOG_DISABLED" }

    $proofId = [guid]::NewGuid().ToString("N")
    $scheduledFor = (Get-Date).AddSeconds(45)
    $powershell = (Get-Command powershell.exe -ErrorAction Stop).Source
    $escapedRoot = $Root.Replace('"', '""')
    $escapedProofScript = $ProofScript.Replace('"', '""')
    $arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$escapedProofScript`" -Root `"$escapedRoot`" -ProofId `"$proofId`""

    $action = New-ScheduledTaskAction -Execute $powershell -Argument $arguments -WorkingDirectory $Root
    $trigger = New-ScheduledTaskTrigger -Once -At $scheduledFor
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
    $userId = if ($env:USERDOMAIN) { "$($env:USERDOMAIN)\$($env:USERNAME)" } else { $env:USERNAME }
    $principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited

    $task = New-ScheduledTask -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description "One-shot proof that the independent MILES control-owner watchdog can recover miles-autonomous-coo after a controlled stop."
    Register-ScheduledTask -TaskName $TaskName -InputObject $task -Force | Out-Null

    $registered = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
    if (-not $registered) { throw "RECOVERY_PROOF_TASK_READBACK_FAILED" }

    $evidence = Write-ScheduleEvidence -Ok $true -Status "CONTROL_OWNER_RECOVERY_PROOF_SCHEDULED" -ProofId $proofId -ScheduledFor $scheduledFor
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
