param(
    [string]$Root = "C:\P2GC_Intelligence\MILES_ENTERPRISE"
)

$ErrorActionPreference = "Stop"
$ProcessName = "miles-autonomous-coo"
$EvidencePath = Join-Path $Root "DATA\runtime\control_owner_watchdog_latest.json"
$BridgeSupervisorStatePath = Join-Path $Root "DATA\runtime\remote_execution_bridge_supervisor.json"
$BridgeStatePath = Join-Path $Root "DATA\runtime\remote_execution_bridge_state.json"
$BridgeEvidencePath = Join-Path $Root "DATA\runtime\remote_execution_bridge_evidence.json"
$BridgeConsumptionWatchPath = Join-Path $Root "DATA\runtime\remote_execution_bridge_consumption_watch.json"
$ControlDirectiveUrl = "https://raw.githubusercontent.com/lifesalt5-netizen/MILES_ENTERPRISE/miles-control/DATA/control/miles_remote_execution_directive.json"
$ControlDirectiveProbeTimeoutSeconds = 15
$ControlDirectivePickupGraceSeconds = 120
$BridgeEvidenceFreshSeconds = 180

function Read-JsonSafe {
    param([string]$Path)
    try {
        if (-not (Test-Path -LiteralPath $Path)) { return $null }
        return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
    }
    catch { return $null }
}

function Write-JsonAtomic {
    param([string]$Path, [object]$Payload)
    $parent = Split-Path -Parent $Path
    if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
    $temporary = "$Path.$PID.$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()).tmp"
    $Payload | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $temporary -Encoding UTF8
    try { Move-Item -LiteralPath $temporary -Destination $Path -Force }
    finally { if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue } }
}

function Get-CurrentControlDirective {
    try {
        $nonce = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        $uri = "${ControlDirectiveUrl}?t=$nonce"
        $headers = @{ "Cache-Control" = "no-cache, no-store"; "Pragma" = "no-cache" }
        $directive = Invoke-RestMethod -Method Get -Uri $uri -Headers $headers -TimeoutSec $ControlDirectiveProbeTimeoutSeconds -ErrorAction Stop
        if (-not $directive -or -not $directive.id) {
            return [pscustomobject]@{ ok = $false; reason = "CONTROL_DIRECTIVE_ID_MISSING"; id = $null; job = $null; error = $null }
        }
        return [pscustomobject]@{ ok = $true; reason = "CONTROL_DIRECTIVE_PROBE_OK"; id = [string]$directive.id; job = [string]$directive.job; error = $null }
    }
    catch {
        return [pscustomobject]@{ ok = $false; reason = "CONTROL_DIRECTIVE_PROBE_FAILED"; id = $null; job = $null; error = $_.Exception.Message }
    }
}

function Get-BridgeEvidenceObservedAt {
    param($Evidence)
    if (-not $Evidence) { return $null }
    foreach ($candidate in @($Evidence.finishedAt, $Evidence.observedAt, $Evidence.startedAt)) {
        if (-not $candidate) { continue }
        try { return [datetime]::Parse([string]$candidate).ToUniversalTime() } catch {}
    }
    return $null
}

function Get-ControlBridgeConsumptionHealth {
    param([datetime]$MinObservedAt = [datetime]::MinValue)

    $directive = Get-CurrentControlDirective
    $bridgeState = Read-JsonSafe -Path $BridgeStatePath
    $bridgeEvidence = Read-JsonSafe -Path $BridgeEvidencePath
    $watch = Read-JsonSafe -Path $BridgeConsumptionWatchPath
    $nowUtc = (Get-Date).ToUniversalTime()
    $lastDirectiveId = if ($bridgeState -and $bridgeState.lastDirectiveId) { [string]$bridgeState.lastDirectiveId } else { $null }

    if (-not [bool]$directive.ok) {
        return [pscustomobject]@{
            healthy = $true
            verified = $false
            reason = "BRIDGE_CONTROL_PROBE_UNAVAILABLE_GRACE"
            currentDirectiveId = $null
            currentDirectiveJob = $null
            lastDirectiveId = $lastDirectiveId
            evidenceDirectiveId = if ($bridgeEvidence -and $bridgeEvidence.directiveId) { [string]$bridgeEvidence.directiveId } else { $null }
            evidencePhase = if ($bridgeEvidence -and $bridgeEvidence.phase) { [string]$bridgeEvidence.phase } else { $null }
            evidenceAgeSeconds = $null
            mismatchAgeSeconds = $null
            probeError = [string]$directive.error
        }
    }

    $currentDirectiveId = [string]$directive.id
    if ($lastDirectiveId -eq $currentDirectiveId) {
        Write-JsonAtomic -Path $BridgeConsumptionWatchPath -Payload ([ordered]@{
            ok = $true
            status = "CONTROL_DIRECTIVE_CURRENT"
            directiveId = $currentDirectiveId
            firstSeenAt = $nowUtc.ToString("o")
            lastObservedAt = $nowUtc.ToString("o")
        })
        return [pscustomobject]@{
            healthy = $true
            verified = $true
            reason = "BRIDGE_CONTROL_DIRECTIVE_CURRENT"
            currentDirectiveId = $currentDirectiveId
            currentDirectiveJob = [string]$directive.job
            lastDirectiveId = $lastDirectiveId
            evidenceDirectiveId = if ($bridgeEvidence -and $bridgeEvidence.directiveId) { [string]$bridgeEvidence.directiveId } else { $null }
            evidencePhase = if ($bridgeEvidence -and $bridgeEvidence.phase) { [string]$bridgeEvidence.phase } else { $null }
            evidenceAgeSeconds = $null
            mismatchAgeSeconds = 0
            probeError = $null
        }
    }

    $evidenceDirectiveId = if ($bridgeEvidence -and $bridgeEvidence.directiveId) { [string]$bridgeEvidence.directiveId } else { $null }
    $evidencePhase = if ($bridgeEvidence -and $bridgeEvidence.phase) { [string]$bridgeEvidence.phase } else { $null }
    $evidenceObservedAt = Get-BridgeEvidenceObservedAt -Evidence $bridgeEvidence
    $evidenceAgeSeconds = $null
    $evidenceFresh = $false
    $evidencePostMinimum = $true
    if ($evidenceObservedAt) {
        $evidenceAgeSeconds = ($nowUtc - $evidenceObservedAt).TotalSeconds
        $evidenceFresh = $evidenceAgeSeconds -ge 0 -and $evidenceAgeSeconds -le $BridgeEvidenceFreshSeconds
        if ($MinObservedAt -ne [datetime]::MinValue) { $evidencePostMinimum = $evidenceObservedAt -ge $MinObservedAt.ToUniversalTime() }
    }
    $activePhase = @("STARTED", "RUNNING", "COMPLETED") -contains $evidencePhase.ToUpperInvariant()
    if ($evidenceDirectiveId -eq $currentDirectiveId -and $activePhase -and $evidenceFresh -and $evidencePostMinimum) {
        Write-JsonAtomic -Path $BridgeConsumptionWatchPath -Payload ([ordered]@{
            ok = $true
            status = "CONTROL_DIRECTIVE_IN_PROGRESS_OR_RECENT"
            directiveId = $currentDirectiveId
            firstSeenAt = $nowUtc.ToString("o")
            lastObservedAt = $nowUtc.ToString("o")
            evidencePhase = $evidencePhase
        })
        return [pscustomobject]@{
            healthy = $true
            verified = $true
            reason = "BRIDGE_CONTROL_DIRECTIVE_PROCESSING"
            currentDirectiveId = $currentDirectiveId
            currentDirectiveJob = [string]$directive.job
            lastDirectiveId = $lastDirectiveId
            evidenceDirectiveId = $evidenceDirectiveId
            evidencePhase = $evidencePhase
            evidenceAgeSeconds = [math]::Round($evidenceAgeSeconds, 2)
            mismatchAgeSeconds = 0
            probeError = $null
        }
    }

    $firstSeenAt = $null
    if ($watch -and [string]$watch.directiveId -eq $currentDirectiveId -and $watch.firstSeenAt) {
        try { $firstSeenAt = [datetime]::Parse([string]$watch.firstSeenAt).ToUniversalTime() } catch {}
    }
    if (-not $firstSeenAt) { $firstSeenAt = $nowUtc }
    $mismatchAgeSeconds = ($nowUtc - $firstSeenAt).TotalSeconds
    $withinGrace = $mismatchAgeSeconds -ge 0 -and $mismatchAgeSeconds -le $ControlDirectivePickupGraceSeconds
    Write-JsonAtomic -Path $BridgeConsumptionWatchPath -Payload ([ordered]@{
        ok = $withinGrace
        status = if ($withinGrace) { "CONTROL_DIRECTIVE_PICKUP_GRACE" } else { "CONTROL_DIRECTIVE_CONSUMPTION_STALLED" }
        directiveId = $currentDirectiveId
        job = [string]$directive.job
        firstSeenAt = $firstSeenAt.ToString("o")
        lastObservedAt = $nowUtc.ToString("o")
        lastDirectiveId = $lastDirectiveId
        evidenceDirectiveId = $evidenceDirectiveId
        evidencePhase = $evidencePhase
        mismatchAgeSeconds = [math]::Round($mismatchAgeSeconds, 2)
    })

    return [pscustomobject]@{
        healthy = $withinGrace
        verified = $false
        reason = if ($withinGrace) { "BRIDGE_CONTROL_DIRECTIVE_PICKUP_GRACE" } else { "BRIDGE_DIRECTIVE_CONSUMPTION_STALLED" }
        currentDirectiveId = $currentDirectiveId
        currentDirectiveJob = [string]$directive.job
        lastDirectiveId = $lastDirectiveId
        evidenceDirectiveId = $evidenceDirectiveId
        evidencePhase = $evidencePhase
        evidenceAgeSeconds = if ($null -ne $evidenceAgeSeconds) { [math]::Round($evidenceAgeSeconds, 2) } else { $null }
        mismatchAgeSeconds = [math]::Round($mismatchAgeSeconds, 2)
        probeError = $null
    }
}

function Get-ControlBridgeHealth {
    param([datetime]$MinObservedAt = [datetime]::MinValue, [int]$MaxAgeSeconds = 30)
    $state = Read-JsonSafe -Path $BridgeSupervisorStatePath
    if (-not $state) {
        return [pscustomobject]@{ healthy = $false; controlVerified = $false; reason = "BRIDGE_SUPERVISOR_STATE_MISSING"; status = $null; childPid = $null; observedAt = $null; ageSeconds = $null; consumption = $null }
    }
    try { $observed = [datetime]::Parse([string]$state.observedAt).ToUniversalTime() }
    catch { return [pscustomobject]@{ healthy = $false; controlVerified = $false; reason = "BRIDGE_SUPERVISOR_OBSERVED_AT_INVALID"; status = [string]$state.status; childPid = $state.childPid; observedAt = $state.observedAt; ageSeconds = $null; consumption = $null } }
    $age = ((Get-Date).ToUniversalTime() - $observed).TotalSeconds
    $bridgeChildPid = 0
    try { $bridgeChildPid = [int]$state.childPid } catch { $bridgeChildPid = 0 }
    $alive = $false
    if ($bridgeChildPid -gt 0) { $alive = [bool](Get-Process -Id $bridgeChildPid -ErrorAction SilentlyContinue) }
    $supervisorHealthy = $age -ge 0 -and $age -le $MaxAgeSeconds -and $observed -ge $MinObservedAt.ToUniversalTime() -and [string]$state.status -eq "BRIDGE_RUNNING" -and $alive
    if (-not $supervisorHealthy) {
        $reason = if ($age -lt 0 -or $age -gt $MaxAgeSeconds) { "BRIDGE_SUPERVISOR_STATE_STALE" } elseif ($observed -lt $MinObservedAt.ToUniversalTime()) { "BRIDGE_SUPERVISOR_STATE_PREDATES_RECOVERY" } elseif ([string]$state.status -ne "BRIDGE_RUNNING") { "BRIDGE_SUPERVISOR_NOT_RUNNING" } elseif (-not $alive) { "BRIDGE_CHILD_NOT_ALIVE" } else { "BRIDGE_HEALTH_UNKNOWN" }
        return [pscustomobject]@{ healthy = $false; controlVerified = $false; reason = $reason; status = [string]$state.status; childPid = if ($bridgeChildPid -gt 0) { $bridgeChildPid } else { $null }; observedAt = $observed.ToString("o"); ageSeconds = [math]::Round($age, 2); consumption = $null }
    }

    $consumption = Get-ControlBridgeConsumptionHealth -MinObservedAt $MinObservedAt
    $healthy = $supervisorHealthy -and [bool]$consumption.healthy
    $reason = if (-not $healthy) { [string]$consumption.reason } elseif ([bool]$consumption.verified) { "BRIDGE_RUNNING_FRESH_CHILD_ALIVE_CONTROL_CONSUMPTION_CURRENT" } else { "BRIDGE_RUNNING_FRESH_CHILD_ALIVE_CONTROL_CONSUMPTION_WATCH" }
    return [pscustomobject]@{
        healthy = $healthy
        controlVerified = [bool]$consumption.verified
        reason = $reason
        status = [string]$state.status
        childPid = if ($bridgeChildPid -gt 0) { $bridgeChildPid } else { $null }
        observedAt = $observed.ToString("o")
        ageSeconds = [math]::Round($age, 2)
        consumption = $consumption
    }
}

function Write-WatchdogEvidence {
    param(
        [bool]$Ok,
        [string]$Status,
        [string]$Action,
        [string]$RecoveryReason = $null,
        $BridgeHealth = $null,
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
        recoveryReason = $RecoveryReason
        processName = $ProcessName
        bridgeHealth = $BridgeHealth
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

    $payload | ConvertTo-Json -Depth 9 | Set-Content -LiteralPath $EvidencePath -Encoding UTF8
    return $payload
}

function Get-Pm2Process {
    param([string]$Name)

    $json = (& pm2.cmd jlist 2>$null) -join "`n"
    if ([string]::IsNullOrWhiteSpace($json)) { return $null }

    $nodeProbe = @'
const fs = require('fs');
const name = String(process.argv[1] || '');
let rows;
try {
  rows = JSON.parse(fs.readFileSync(0, 'utf8'));
} catch (error) {
  process.stderr.write('PM2_JLIST_JSON_PARSE_FAILED:' + error.message);
  process.exit(2);
}
const row = Array.isArray(rows) ? rows.find(item => String(item && item.name) === name) : null;
if (!row) {
  process.stdout.write('NOT_FOUND');
  process.exit(0);
}
const status = String(row.pm2_env && row.pm2_env.status || '');
process.stdout.write('FOUND\t' + status);
'@

    $probe = ($json | & node.exe -e $nodeProbe $Name 2>$null) -join "`n"
    if ($LASTEXITCODE -ne 0) { throw "PM2_JLIST_PARSE_FAILED" }
    $probe = [string]$probe
    $probe = $probe.Trim()
    if ($probe -eq "NOT_FOUND") { return $null }
    $prefix = "FOUND`t"
    if (-not $probe.StartsWith($prefix, [System.StringComparison]::Ordinal)) { throw "PM2_JLIST_PROBE_INVALID" }
    $status = $probe.Substring($prefix.Length)
    return [pscustomobject]@{ name = $Name; pm2_env = [pscustomobject]@{ status = $status } }
}

try {
    if (-not (Test-Path -LiteralPath (Join-Path $Root ".git"))) { throw "MILES_ROOT_NOT_FOUND:$Root" }
    Set-Location -LiteralPath $Root
    if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) { throw "NODE_NOT_FOUND" }
    if (-not (Get-Command pm2.cmd -ErrorAction SilentlyContinue)) { throw "PM2_NOT_FOUND" }

    $existing = Get-Pm2Process -Name $ProcessName
    $bridgeBefore = Get-ControlBridgeHealth
    if ($existing -and [string]$existing.pm2_env.status -eq "online" -and [bool]$bridgeBefore.healthy) {
        $status = if ([bool]$bridgeBefore.controlVerified) { "CONTROL_OWNER_ONLINE" } else { "CONTROL_OWNER_ONLINE_CONTROL_CONSUMPTION_WATCH" }
        $evidence = Write-WatchdogEvidence -Ok $true -Status $status -Action "NONE_ALREADY_ONLINE" -BridgeHealth $bridgeBefore
        if ([bool]$bridgeBefore.controlVerified) { Write-Host "MILES_CONTROL_OWNER_WATCHDOG_GREEN" } else { Write-Host "MILES_CONTROL_OWNER_WATCHDOG_WATCH" }
        Write-Host ($evidence | ConvertTo-Json -Compress -Depth 9)
        exit 0
    }

    $required = @("SCRIPTS\RuntimeGenerationGuard.js", "StartAutonomousCOO.js", "StartMilesRemoteExecutionBridge.js")
    foreach ($file in $required) {
        $full = Join-Path $Root $file
        if (-not (Test-Path -LiteralPath $full)) { throw "REQUIRED_FILE_MISSING:$file" }
        & node.exe --check $full | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "NODE_CHECK_FAILED:$file" }
    }

    $recoveryStartedAt = (Get-Date).ToUniversalTime()
    $action = $null
    $recoveryReason = if ($existing -and [string]$existing.pm2_env.status -eq "online") { "CONTROL_BRIDGE_UNHEALTHY:$([string]$bridgeBefore.reason)" } else { "CONTROL_OWNER_NOT_ONLINE" }
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
    $verified = $null
    $bridgeAfter = $null
    $deadline = (Get-Date).AddSeconds(120)
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 3
        $verified = Get-Pm2Process -Name $ProcessName
        $bridgeAfter = Get-ControlBridgeHealth -MinObservedAt $recoveryStartedAt
        if ($verified -and [string]$verified.pm2_env.status -eq "online" -and [bool]$bridgeAfter.healthy -and [bool]$bridgeAfter.controlVerified) { break }
    }
    if (-not $verified -or [string]$verified.pm2_env.status -ne "online") { throw "CONTROL_OWNER_NOT_ONLINE_AFTER_RECOVERY" }
    if (-not $bridgeAfter -or -not [bool]$bridgeAfter.healthy -or -not [bool]$bridgeAfter.controlVerified) { throw "CONTROL_BRIDGE_NOT_HEALTHY_AFTER_RECOVERY:$([string]$bridgeAfter.reason)" }

    $evidence = Write-WatchdogEvidence -Ok $true -Status "CONTROL_OWNER_RECOVERED" -Action $action -RecoveryReason $recoveryReason -BridgeHealth $bridgeAfter
    Write-Host "MILES_CONTROL_OWNER_WATCHDOG_GREEN"
    Write-Host ($evidence | ConvertTo-Json -Compress -Depth 9)
    exit 0
}
catch {
    $message = $_.Exception.Message
    $bridgeFailure = Get-ControlBridgeHealth
    $evidence = Write-WatchdogEvidence -Ok $false -Status "CONTROL_OWNER_WATCHDOG_RED" -Action "FAIL_CLOSED" -BridgeHealth $bridgeFailure -ErrorMessage $message
    Write-Error $message
    Write-Host ($evidence | ConvertTo-Json -Compress -Depth 9)
    exit 2
}
