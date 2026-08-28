param(
    [string]$Root = "C:\P2GC_Intelligence\MILES_ENTERPRISE"
)

$ErrorActionPreference = "Stop"
$WatchdogProcess = Join-Path $Root "StartMilesControlOwnerWatchdog.js"
$HeartbeatPath = Join-Path $Root "DATA\runtime\control_owner_watchdog_process_latest.json"
$EvidencePath = Join-Path $Root "DATA\runtime\control_owner_watchdog_install_latest.json"
$ShortcutName = "MILES-ControlOwner-Watchdog.lnk"

function Read-JsonSafe {
    param([string]$Path)
    try {
        if (-not (Test-Path -LiteralPath $Path)) { return $null }
        return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
    }
    catch { return $null }
}

function Test-HeartbeatLive {
    param($Heartbeat, [int]$MaxAgeSeconds = 180)
    if (-not $Heartbeat -or -not $Heartbeat.observedAt -or -not $Heartbeat.pid) { return $false }
    try {
        $observed = [datetime]::Parse([string]$Heartbeat.observedAt).ToUniversalTime()
        $age = ((Get-Date).ToUniversalTime() - $observed).TotalSeconds
        if ($age -lt 0 -or $age -gt $MaxAgeSeconds) { return $false }
        $process = Get-Process -Id ([int]$Heartbeat.pid) -ErrorAction SilentlyContinue
        return [bool]$process
    }
    catch { return $false }
}

function Write-InstallEvidence {
    param(
        [bool]$Ok,
        [string]$Status,
        [string]$Mode = $null,
        [string]$StartupShortcut = $null,
        [Nullable[int]]$WatchdogPid = $null,
        [string]$ErrorMessage = $null
    )
    $parent = Split-Path -Parent $EvidencePath
    if (-not (Test-Path -LiteralPath $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    $payload = [ordered]@{
        ok = $Ok
        status = $Status
        mode = $Mode
        watchdogProcess = $WatchdogProcess
        startupShortcut = $StartupShortcut
        watchdogPid = $WatchdogPid
        heartbeatPath = $HeartbeatPath
        observedAt = (Get-Date).ToUniversalTime().ToString("o")
        error = $ErrorMessage
        resilience = [ordered]@{
            currentSessionIndependentOfPm2Owner = $true
            persistsAcrossInteractiveUserLogon = $true
            preLogonRecoveryClaimed = $false
        }
        safety = [ordered]@{
            fixedWatchdogOnly = $true
            arbitraryShell = $false
            gitMutation = $false
            providerMutation = $false
            destructiveGitRecovery = $false
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
    if (-not (Test-Path -LiteralPath (Join-Path $Root ".git"))) { throw "MILES_ROOT_NOT_FOUND:$Root" }
    if (-not (Test-Path -LiteralPath $WatchdogProcess)) { throw "WATCHDOG_PROCESS_SCRIPT_NOT_FOUND:$WatchdogProcess" }

    $node = (Get-Command node.exe -ErrorAction Stop).Source
    & $node --check $WatchdogProcess | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "WATCHDOG_PROCESS_NODE_CHECK_FAILED" }

    $startup = [Environment]::GetFolderPath("Startup")
    if ([string]::IsNullOrWhiteSpace($startup)) {
        $startup = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup"
    }
    if ([string]::IsNullOrWhiteSpace($startup)) { throw "USER_STARTUP_FOLDER_NOT_RESOLVED" }
    if (-not (Test-Path -LiteralPath $startup)) { New-Item -ItemType Directory -Path $startup -Force | Out-Null }

    $shortcutPath = Join-Path $startup $ShortcutName
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $node
    $shortcut.Arguments = "`"$WatchdogProcess`""
    $shortcut.WorkingDirectory = $Root
    $shortcut.WindowStyle = 7
    $shortcut.Description = "Independent user-level MILES control-owner watchdog."
    $shortcut.Save()
    if (-not (Test-Path -LiteralPath $shortcutPath)) { throw "STARTUP_SHORTCUT_CREATE_FAILED:$shortcutPath" }

    $heartbeat = Read-JsonSafe -Path $HeartbeatPath
    if (-not (Test-HeartbeatLive -Heartbeat $heartbeat)) {
        Start-Process -FilePath $node -ArgumentList @($WatchdogProcess) -WorkingDirectory $Root -WindowStyle Hidden | Out-Null
    }

    $deadline = (Get-Date).AddSeconds(45)
    $live = $null
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 2
        $candidate = Read-JsonSafe -Path $HeartbeatPath
        if (Test-HeartbeatLive -Heartbeat $candidate) {
            $live = $candidate
            break
        }
    }
    if (-not $live) { throw "USER_STARTUP_WATCHDOG_HEARTBEAT_NOT_OBSERVED_WITHIN_45_SECONDS" }

    $evidence = Write-InstallEvidence -Ok $true -Status "CONTROL_OWNER_WATCHDOG_INSTALLED" -Mode "USER_STARTUP_INDEPENDENT_PROCESS" -StartupShortcut $shortcutPath -WatchdogPid ([int]$live.pid)
    Write-Host "MILES_CONTROL_OWNER_WATCHDOG_INSTALL_GREEN"
    Write-Host ($evidence | ConvertTo-Json -Compress -Depth 6)
    exit 0
}
catch {
    $message = $_.Exception.Message
    $evidence = Write-InstallEvidence -Ok $false -Status "CONTROL_OWNER_WATCHDOG_INSTALL_RED" -ErrorMessage $message
    Write-Error $message
    Write-Host ($evidence | ConvertTo-Json -Compress -Depth 6)
    exit 2
}
