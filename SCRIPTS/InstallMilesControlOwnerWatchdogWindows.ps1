param(
    [string]$Root = "C:\P2GC_Intelligence\MILES_ENTERPRISE",
    [string]$TaskName = "MILES-ControlOwner-Watchdog"
)

$ErrorActionPreference = "Stop"
$Watchdog = Join-Path $Root "SCRIPTS\EnsureMilesControlOwnerWindows.ps1"
$EvidencePath = Join-Path $Root "DATA\runtime\control_owner_watchdog_install_latest.json"

function Write-InstallEvidence {
    param([bool]$Ok, [string]$Status, [string]$ErrorMessage = $null)
    $parent = Split-Path -Parent $EvidencePath
    if (-not (Test-Path -LiteralPath $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    $payload = [ordered]@{
        ok = $Ok
        status = $Status
        taskName = $TaskName
        watchdog = $Watchdog
        observedAt = (Get-Date).ToUniversalTime().ToString("o")
        error = $ErrorMessage
        safety = [ordered]@{
            fixedWatchdogOnly = $true
            arbitraryShell = $false
            providerMutation = $false
            destructiveGitRecovery = $false
        }
    }
    $payload | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $EvidencePath -Encoding UTF8
    return $payload
}

try {
    if ($env:OS -ne "Windows_NT") { throw "WINDOWS_REQUIRED" }
    if (-not (Test-Path -LiteralPath $Watchdog)) { throw "WATCHDOG_SCRIPT_NOT_FOUND:$Watchdog" }

    $powershell = (Get-Command powershell.exe -ErrorAction Stop).Source
    $escapedRoot = $Root.Replace('"', '""')
    $escapedWatchdog = $Watchdog.Replace('"', '""')
    $arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$escapedWatchdog`" -Root `"$escapedRoot`""

    $action = New-ScheduledTaskAction -Execute $powershell -Argument $arguments -WorkingDirectory $Root
    $logonTrigger = New-ScheduledTaskTrigger -AtLogOn
    $recurringTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration (New-TimeSpan -Days 3650)
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 5)

    $userId = if ($env:USERDOMAIN) { "$($env:USERDOMAIN)\$($env:USERNAME)" } else { $env:USERNAME }
    $principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited

    $task = New-ScheduledTask -Action $action -Trigger @($logonTrigger, $recurringTrigger) -Settings $settings -Principal $principal -Description "Keeps the fixed MILES miles-autonomous-coo control owner online without CEO shell intervention."
    Register-ScheduledTask -TaskName $TaskName -InputObject $task -Force | Out-Null

    $registered = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
    if (-not $registered) { throw "SCHEDULED_TASK_READBACK_FAILED" }

    Start-ScheduledTask -TaskName $TaskName
    Start-Sleep -Seconds 2

    $evidence = Write-InstallEvidence -Ok $true -Status "CONTROL_OWNER_WATCHDOG_INSTALLED"
    Write-Host "MILES_CONTROL_OWNER_WATCHDOG_INSTALL_GREEN"
    Write-Host ($evidence | ConvertTo-Json -Compress -Depth 5)
    exit 0
}
catch {
    $message = $_.Exception.Message
    $evidence = Write-InstallEvidence -Ok $false -Status "CONTROL_OWNER_WATCHDOG_INSTALL_RED" -ErrorMessage $message
    Write-Error $message
    Write-Host ($evidence | ConvertTo-Json -Compress -Depth 5)
    exit 2
}
