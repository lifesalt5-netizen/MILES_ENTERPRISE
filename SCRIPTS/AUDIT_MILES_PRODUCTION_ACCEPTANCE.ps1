param(
    [string]$Root = "C:\P2GC_Intelligence\MILES_ENTERPRISE"
)

$ErrorActionPreference = "Stop"

function Invoke-GitProbe {
    param([string]$WorkingDirectory,[Parameter(ValueFromRemainingArguments=$true)][string[]]$Args)
    $prior = $ErrorActionPreference
    try {
        $ErrorActionPreference = "Continue"
        Push-Location $WorkingDirectory
        try {
            $output = & git @Args 2>$null
            $code = $LASTEXITCODE
        } finally { Pop-Location }
    } finally { $ErrorActionPreference = $prior }
    return [pscustomobject]@{ exit_code=$code; output=@($output | ForEach-Object { [string]$_ }) }
}

function Invoke-NodeCheck([string]$WorkingDirectory,[string]$RelativePath) {
    $full = Join-Path $WorkingDirectory ($RelativePath -replace '/','\')
    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) {
        return [pscustomobject]@{ path=$RelativePath; exists=$false; syntax_ok=$false; exit_code=-1; output='FILE_MISSING' }
    }
    $prior = $ErrorActionPreference
    try {
        $ErrorActionPreference = "Continue"
        Push-Location $WorkingDirectory
        try {
            $output = & node --check $RelativePath 2>&1
            $code = $LASTEXITCODE
        } finally { Pop-Location }
    } finally { $ErrorActionPreference = $prior }
    return [pscustomobject]@{ path=$RelativePath; exists=$true; syntax_ok=($code -eq 0); exit_code=$code; output=($output -join "`n") }
}

function Get-PortState([int]$Port) {
    $listeners = @()
    try { $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) } catch {}
    return [pscustomobject]@{
        port=$Port
        listening=($listeners.Count -gt 0)
        owning_process_ids=@($listeners | Select-Object -ExpandProperty OwningProcess -Unique)
    }
}

function Invoke-HttpProbe([string]$Url) {
    try {
        $response = Invoke-WebRequest -Uri $Url -Method Get -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
        return [pscustomobject]@{ url=$Url; ok=($response.StatusCode -ge 200 -and $response.StatusCode -lt 400); status_code=[int]$response.StatusCode; body=[string]$response.Content; error='' }
    } catch {
        $status = 0
        try { $status = [int]$_.Exception.Response.StatusCode.value__ } catch {}
        return [pscustomobject]@{ url=$Url; ok=$false; status_code=$status; body=''; error=$_.Exception.Message }
    }
}

function Read-EnvKeyNames([string]$EnvPath) {
    if (-not (Test-Path -LiteralPath $EnvPath -PathType Leaf)) { return @() }
    $keys = @()
    foreach ($line in Get-Content -LiteralPath $EnvPath) {
        $text = [string]$line
        if (-not $text) { continue }
        $text = $text.Trim()
        if (-not $text -or $text.StartsWith('#')) { continue }
        if ($text -match '^([A-Za-z_][A-Za-z0-9_]*)\s*=') { $keys += $Matches[1].ToUpperInvariant() }
    }
    return @($keys | Sort-Object -Unique)
}

function Test-Mojibake([string]$Text) {
    if (-not $Text) { return $false }

    # Keep this source ASCII-only so Windows PowerShell 5.1 cannot corrupt
    # mojibake detector literals while parsing the audit script.
    $fragments = @(
        [string]::Concat([char]0x0393, [char]0x00E4),
        [string]([char]0x00C3),
        [string]([char]0x00C2),
        [string]::Concat([char]0x00E2, [char]0x20AC),
        [string]::Concat([char]0x00EF, [char]0x00BF, [char]0x00BD),
        [string]([char]0xFFFD)
    )

    foreach ($fragment in $fragments) {
        if ($Text.Contains($fragment)) { return $true }
    }
    return $false
}

if (-not (Test-Path -LiteralPath $Root -PathType Container)) { throw "MILES root not found: $Root" }
if (-not (Test-Path -LiteralPath (Join-Path $Root '.git'))) { throw "MILES root is not a Git working copy: $Root" }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'git.exe not found in PATH' }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'node.exe not found in PATH' }

Write-Host '============================================================'
Write-Host 'MILES PRODUCTION GO-LIVE ACCEPTANCE AUDIT'
Write-Host '============================================================'
Write-Host "Root: $Root"
Write-Host 'READ ONLY: no process start/stop, no source writes, no outbound sends, no Instantly mutations.'

$headProbe = Invoke-GitProbe $Root rev-parse HEAD
$branchProbe = Invoke-GitProbe $Root rev-parse --abbrev-ref HEAD
$statusProbe = Invoke-GitProbe $Root status --porcelain=v1 --untracked-files=all
$head = if ($headProbe.exit_code -eq 0 -and $headProbe.output.Count) { [string]$headProbe.output[0] } else { '' }
$branch = if ($branchProbe.exit_code -eq 0 -and $branchProbe.output.Count) { [string]$branchProbe.output[0] } else { '' }
$gitClean = ($statusProbe.exit_code -eq 0 -and $statusProbe.output.Count -eq 0)

$entrypoints = @(
    'StartMilesProduction.js',
    'StartProductionSystem.js',
    'StartAutonomousCOO.js',
    'SERVICES/digital_coo/MilesCommandCenter.js',
    'StartMiles.js',
    'StartExecutiveDashboard.js'
)
$entrypointChecks = @($entrypoints | ForEach-Object { Invoke-NodeCheck $Root $_ })
$entrypointsReady = (@($entrypointChecks | Where-Object { -not $_.exists -or -not $_.syntax_ok }).Count -eq 0)

$ports = @(3000,8787,3737,8737)
$portRows = @($ports | ForEach-Object { Get-PortState $_ })
$portsReady = (@($portRows | Where-Object { -not $_.listening }).Count -eq 0)

# Each probe is a separate PowerShell statement. Do not use trailing commas here;
# Windows PowerShell can bind the following expression into the Url argument.
$httpRows = @(
    (Invoke-HttpProbe -Url 'http://127.0.0.1:3000/')
    (Invoke-HttpProbe -Url 'http://127.0.0.1:8787/')
    (Invoke-HttpProbe -Url 'http://127.0.0.1:3737/')
    (Invoke-HttpProbe -Url 'http://127.0.0.1:8737/')
    (Invoke-HttpProbe -Url 'http://127.0.0.1:8737/api/state')
)

$dashboardRoot = $httpRows | Where-Object { $_.url -eq 'http://127.0.0.1:8737/' } | Select-Object -First 1
$dashboardState = $httpRows | Where-Object { $_.url -eq 'http://127.0.0.1:8737/api/state' } | Select-Object -First 1
$dashboardHttpOk = [bool]($dashboardRoot -and $dashboardRoot.ok)
$dashboardStateOk = [bool]($dashboardState -and $dashboardState.ok)
$dashboardMojibake = if ($dashboardRoot) { [bool](Test-Mojibake ([string]$dashboardRoot.body)) } else { $false }
$dashboardStateJson = $null
if ($dashboardStateOk -and $dashboardState.body) {
    try { $dashboardStateJson = $dashboardState.body | ConvertFrom-Json } catch {}
}

$workerStatusPath = Join-Path $Root 'DATA\runtime\worker_runtime_status.json'
$workerStatus = $null
if (Test-Path -LiteralPath $workerStatusPath -PathType Leaf) {
    try { $workerStatus = Get-Content -Raw -LiteralPath $workerStatusPath | ConvertFrom-Json } catch {}
}
$workerRuntimeHealthy = [bool]($workerStatus -and $workerStatus.ok -eq $true -and $workerStatus.lifecycle.started -eq $true -and $workerStatus.lifecycle.shuttingDown -ne $true)

$envKeys = Read-EnvKeyNames (Join-Path $Root '.env')
$instantlyKeyPresent = ($envKeys -contains 'INSTANTLY_API_KEY') -or [bool]$env:INSTANTLY_API_KEY

$revenueTests = @(
    'TESTS/reply_intelligence_classification_test.js',
    'TESTS/reply_intelligence_production_loop_test.js',
    'TESTS/reply_global_suppression_connector_test.js',
    'TESTS/winback_production_loop_test.js',
    'TESTS/winback_campaign_test.js',
    'TESTS/capture_capacity_autonomous_execution_test.js',
    'TESTS/capture_capacity_production_loop_test.js'
)
$revenueTestPresence = @($revenueTests | ForEach-Object {
    [pscustomobject]@{ path=$_; exists=(Test-Path -LiteralPath (Join-Path $Root ($_ -replace '/','\')) -PathType Leaf) }
})
$revenueSafetyCoverageReady = (@($revenueTestPresence | Where-Object { -not $_.exists }).Count -eq 0)

$nodeProcesses = @()
try {
    $nodeProcesses = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ForEach-Object {
        [pscustomobject]@{
            process_id=$_.ProcessId
            executable=$_.ExecutablePath
            command_line=[string]$_.CommandLine
            likely_miles=[bool]([string]$_.CommandLine -match 'MILES|P2GC|StartMiles|StartProductionSystem|StartAutonomousCOO|MilesCommandCenter|StartExecutiveDashboard')
        }
    })
} catch {}

$hardBlockers = @()
if (-not $entrypointsReady) { $hardBlockers += 'ENTRYPOINT_MISSING_OR_SYNTAX_FAILED' }
if (-not $portsReady) { $hardBlockers += 'REQUIRED_PORT_NOT_LISTENING' }
if (-not $workerRuntimeHealthy) { $hardBlockers += 'WORKER_RUNTIME_STATUS_NOT_HEALTHY' }
if (-not $dashboardHttpOk) { $hardBlockers += 'EXECUTIVE_DASHBOARD_HTTP_NOT_HEALTHY' }
if ($dashboardMojibake) { $hardBlockers += 'EXECUTIVE_DASHBOARD_MOJIBAKE_DETECTED' }

$warnings = @()
if (-not $gitClean) { $warnings += 'LIVE_GIT_WORKTREE_NOT_CLEAN' }
if (-not $instantlyKeyPresent) { $warnings += 'INSTANTLY_API_KEY_NAME_NOT_AVAILABLE' }
if (-not $revenueSafetyCoverageReady) { $warnings += 'REVENUE_SAFETY_TEST_FILES_MISSING' }
if (-not $dashboardStateOk) { $warnings += 'DASHBOARD_API_STATE_NOT_HEALTHY' }

$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$outDir = Join-Path $env:TEMP "MILES_PRODUCTION_ACCEPTANCE_$stamp"
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
$jsonPath = Join-Path $outDir 'miles_production_acceptance.json'
$textPath = Join-Path $outDir 'miles_production_acceptance.txt'

$report = [ordered]@{
    generated_at=(Get-Date).ToUniversalTime().ToString('o')
    audit='MILES_PRODUCTION_GO_LIVE_ACCEPTANCE'
    read_only=$true
    ready_for_daily_use=($hardBlockers.Count -eq 0)
    root=$Root
    git=[ordered]@{ head=$head; branch=$branch; clean=$gitClean; status=@($statusProbe.output) }
    entrypoints=$entrypointChecks
    entrypoints_ready=$entrypointsReady
    ports=$portRows
    required_ports_ready=$portsReady
    http=$httpRows | ForEach-Object { [pscustomobject]@{ url=$_.url; ok=$_.ok; status_code=$_.status_code; error=$_.error } }
    worker_runtime_status_file=$workerStatusPath
    worker_runtime_healthy=$workerRuntimeHealthy
    dashboard=[ordered]@{
        http_ok=$dashboardHttpOk
        api_state_ok=$dashboardStateOk
        mojibake_detected=$dashboardMojibake
        state_generated_at=if($dashboardStateJson){[string]$dashboardStateJson.generatedAt}else{''}
    }
    instantly=[ordered]@{
        api_key_name_available=$instantlyKeyPresent
        env_values_read_or_reported=$false
    }
    revenue_safety_test_presence=$revenueTestPresence
    revenue_safety_coverage_ready=$revenueSafetyCoverageReady
    node_processes=$nodeProcesses
    hard_blockers=$hardBlockers
    warnings=$warnings
    safety=[ordered]@{
        source_files_written=$false
        processes_stopped=$false
        processes_started=$false
        outbound_runner_invoked=$false
        instantly_mutations_allowed=$false
        env_values_reported=$false
    }
    next_action=if($hardBlockers.Count -eq 0){'Proceed to functional acceptance of dashboard modules, ORION intelligence, Instantly/reply operations, morning brief, and controlled revenue workflows.'}else{'Resolve hard blockers before declaring MILES ready for daily production use.'}
}
$report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $jsonPath -Encoding UTF8

$summary = @(
    'MILES PRODUCTION GO-LIVE ACCEPTANCE',
    "Ready for daily use: $($report.ready_for_daily_use)",
    "Git HEAD: $head",
    "Git branch: $branch",
    "Git clean: $gitClean",
    "Entrypoints ready: $entrypointsReady",
    "Required ports ready: $portsReady",
    "Worker runtime healthy: $workerRuntimeHealthy",
    "Dashboard HTTP healthy: $dashboardHttpOk",
    "Dashboard API state healthy: $dashboardStateOk",
    "Dashboard mojibake detected: $dashboardMojibake",
    "Instantly API key name available: $instantlyKeyPresent",
    "Revenue safety coverage ready: $revenueSafetyCoverageReady",
    '',
    'HARD BLOCKERS:',
    ($hardBlockers -join "`n"),
    '',
    'WARNINGS:',
    ($warnings -join "`n"),
    '',
    "JSON REPORT: $jsonPath",
    "NEXT ACTION: $($report.next_action)"
)
$summary | Set-Content -LiteralPath $textPath -Encoding UTF8

Write-Host ''
Write-Host "Ready for daily use: $($report.ready_for_daily_use)"
Write-Host "Entrypoints ready: $entrypointsReady"
Write-Host "Required ports ready: $portsReady"
Write-Host "Worker runtime healthy: $workerRuntimeHealthy"
Write-Host "Dashboard HTTP healthy: $dashboardHttpOk"
Write-Host "Dashboard API state healthy: $dashboardStateOk"
Write-Host "Dashboard mojibake detected: $dashboardMojibake"
Write-Host "Instantly API key name available: $instantlyKeyPresent"
Write-Host "Hard blockers: $($hardBlockers.Count)"
if ($hardBlockers.Count -gt 0) { $hardBlockers | ForEach-Object { Write-Host "  BLOCKER: $_" } }
Write-Host "Warnings: $($warnings.Count)"
if ($warnings.Count -gt 0) { $warnings | ForEach-Object { Write-Host "  WARNING: $_" } }
Write-Host ''
Write-Host 'HTTP probes:'
$httpRows | ForEach-Object { Write-Host "  $($_.url) -> ok=$($_.ok) status=$($_.status_code)" }
Write-Host ''
Write-Host 'Reports:'
Write-Host "  $jsonPath"
Write-Host "  $textPath"
Write-Host ''
Write-Host "NEXT ACTION: $($report.next_action)"

exit 0
