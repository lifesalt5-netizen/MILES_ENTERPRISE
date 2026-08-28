param(
    [string]$Root = "C:\P2GC_Intelligence\MILES_ENTERPRISE"
)

$ErrorActionPreference = "Stop"
$ProcessName = "miles-autonomous-coo"
$EvidencePath = Join-Path $Root "DATA\runtime\control_owner_watchdog_latest.json"

function Write-WatchdogEvidence {
    param(
        [bool]$Ok,
        [string]$Status,
        [string]$Action,
        [string]$ErrorMessage = $null
    )

    $parent = Split-Path -Parent $EvidencePath
    if (-not (Test-Path -LiteralPath $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }

    $payload = [ordered]@{
        ok = $Ok
        status = $Status
        action = $Action
        processName = $ProcessName
        observedAt = (Get-Date).ToUniversalTime().ToString("o")
        root = $Root
        error = $ErrorMessage
        safety = [ordered]@{
            fixedCommandAllowlistOnly = $true
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

    $payload | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $EvidencePath -Encoding UTF8
    return $payload
}

function Get-Pm2Process {
    param([string]$Name)
    $json = (& pm2.cmd jlist 2>$null) -join "`n"
    if ([string]::IsNullOrWhiteSpace($json)) { return $null }
    $rows = $json | ConvertFrom-Json
    return @($rows | Where-Object { [string]$_.name -eq $Name } | Select-Object -First 1)[0]
}

try {
    if (-not (Test-Path -LiteralPath (Join-Path $Root ".git"))) {
        throw "MILES_ROOT_NOT_FOUND:$Root"
    }

    Set-Location -LiteralPath $Root

    if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
        throw "NODE_NOT_FOUND"
    }
    if (-not (Get-Command pm2.cmd -ErrorAction SilentlyContinue)) {
        throw "PM2_NOT_FOUND"
    }

    $existing = Get-Pm2Process -Name $ProcessName
    if ($existing -and [string]$existing.pm2_env.status -eq "online") {
        $evidence = Write-WatchdogEvidence -Ok $true -Status "CONTROL_OWNER_ONLINE" -Action "NONE_ALREADY_ONLINE"
        Write-Host "MILES_CONTROL_OWNER_WATCHDOG_GREEN"
        Write-Host ($evidence | ConvertTo-Json -Compress -Depth 6)
        exit 0
    }

    $required = @(
        "SCRIPTS\RuntimeGenerationGuard.js",
        "StartAutonomousCOO.js",
        "StartMilesRemoteExecutionBridge.js"
    )
    foreach ($file in $required) {
        $full = Join-Path $Root $file
        if (-not (Test-Path -LiteralPath $full)) { throw "REQUIRED_FILE_MISSING:$file" }
        & node.exe --check $full | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "NODE_CHECK_FAILED:$file" }
    }

    $action = $null
    if ($existing) {
        & pm2.cmd restart $ProcessName --update-env | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "PM2_RESTART_FAILED" }
        $action = "PM2_RESTART"
    } else {
        & pm2.cmd start "SCRIPTS\RuntimeGenerationGuard.js" --name $ProcessName -- --runtime $ProcessName --entry "StartAutonomousCOO.js" --arg --loop | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "PM2_START_FAILED" }
        $action = "PM2_GUARDED_START"
    }

    & pm2.cmd save | Out-Null
    Start-Sleep -Seconds 3

    $verified = Get-Pm2Process -Name $ProcessName
    if (-not $verified -or [string]$verified.pm2_env.status -ne "online") {
        throw "CONTROL_OWNER_NOT_ONLINE_AFTER_RECOVERY"
    }

    $evidence = Write-WatchdogEvidence -Ok $true -Status "CONTROL_OWNER_RECOVERED" -Action $action
    Write-Host "MILES_CONTROL_OWNER_WATCHDOG_GREEN"
    Write-Host ($evidence | ConvertTo-Json -Compress -Depth 6)
    exit 0
}
catch {
    $message = $_.Exception.Message
    $evidence = Write-WatchdogEvidence -Ok $false -Status "CONTROL_OWNER_WATCHDOG_RED" -Action "FAIL_CLOSED" -ErrorMessage $message
    Write-Error $message
    Write-Host ($evidence | ConvertTo-Json -Compress -Depth 6)
    exit 2
}
