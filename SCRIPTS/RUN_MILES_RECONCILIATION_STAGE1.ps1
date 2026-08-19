param(
    [string]$RepoRoot = "C:\P2GC_Intelligence\MILES_ENTERPRISE",
    [string]$ShadowParent = "C:\P2GC_Intelligence"
)

$ErrorActionPreference = "Stop"

function Invoke-GitProbe {
    param(
        [string]$WorkingDirectory,
        [Parameter(ValueFromRemainingArguments=$true)][string[]]$Args
    )
    $prior = $ErrorActionPreference
    try {
        $ErrorActionPreference = "Continue"
        Push-Location $WorkingDirectory
        try {
            $output = & git @Args 2>&1
            $code = $LASTEXITCODE
        } finally {
            Pop-Location
        }
    } finally {
        $ErrorActionPreference = $prior
    }
    return [pscustomobject]@{ exit_code = $code; output = @($output | ForEach-Object { [string]$_ }) }
}

function Invoke-NodeCheck {
    param([string]$WorkingDirectory, [string]$RelativePath)
    $full = Join-Path $WorkingDirectory ($RelativePath -replace '/','\')
    if (-not (Test-Path $full -PathType Leaf)) {
        return [pscustomobject]@{ path=$RelativePath; kind='syntax'; ok=$false; exit_code=-1; output='FILE_MISSING' }
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
    return [pscustomobject]@{ path=$RelativePath; kind='syntax'; ok=($code -eq 0); exit_code=$code; output=($output -join "`n") }
}

function Invoke-NodeTest {
    param([string]$WorkingDirectory, [string]$RelativePath)
    $full = Join-Path $WorkingDirectory ($RelativePath -replace '/','\')
    if (-not (Test-Path $full -PathType Leaf)) {
        return [pscustomobject]@{ path=$RelativePath; kind='test'; ok=$false; exit_code=-1; output='FILE_MISSING' }
    }
    $prior = $ErrorActionPreference
    try {
        $ErrorActionPreference = "Continue"
        Push-Location $WorkingDirectory
        try {
            $output = & node $RelativePath 2>&1
            $code = $LASTEXITCODE
        } finally { Pop-Location }
    } finally { $ErrorActionPreference = $prior }
    return [pscustomobject]@{ path=$RelativePath; kind='test'; ok=($code -eq 0); exit_code=$code; output=($output -join "`n") }
}

if (-not (Test-Path $RepoRoot)) { throw "Live MILES repository not found: $RepoRoot" }
if (-not (Test-Path (Join-Path $RepoRoot '.git'))) { throw "Not a Git working copy: $RepoRoot" }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'git.exe not found in PATH' }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'node.exe not found in PATH' }

Write-Host "============================================================"
Write-Host "MILES RECONCILIATION STAGE 1 - SOURCE AUDIT + SHADOW BASELINE"
Write-Host "============================================================"
Write-Host "Live repository: $RepoRoot"
Write-Host "The live checkout will not be merged, reset, rebased, cleaned, or overwritten."
Write-Host "No .env file will be copied or loaded into the shadow runtime."
Write-Host "No MILES production process will be started."

$fetch = Invoke-GitProbe $RepoRoot fetch origin main
if ($fetch.exit_code -ne 0) { throw "git fetch origin main failed:`n$($fetch.output -join "`n")" }
$originProbe = Invoke-GitProbe $RepoRoot rev-parse origin/main
if ($originProbe.exit_code -ne 0) { throw 'origin/main could not be resolved.' }
$originMain = [string]$originProbe.output[0]

$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$outDir = Join-Path $env:TEMP "MILES_RECONCILIATION_STAGE1_$stamp"
New-Item -ItemType Directory -Path $outDir -Force | Out-Null

# Run the read-only live-source reconciliation directly from origin/main so the
# unrelated live branch never needs to check out GitHub code.
$sourceAuditTemp = Join-Path $outDir 'AUDIT_MILES_LIVE_SOURCE_RECONCILIATION.ps1'
$showAudit = Invoke-GitProbe $RepoRoot show 'origin/main:SCRIPTS/AUDIT_MILES_LIVE_SOURCE_RECONCILIATION.ps1'
if ($showAudit.exit_code -ne 0) { throw 'Unable to read source reconciliation audit from origin/main.' }
$showAudit.output | Set-Content -Path $sourceAuditTemp -Encoding UTF8

$prior = $ErrorActionPreference
try {
    $ErrorActionPreference = "Continue"
    $sourceAuditOutput = & powershell -NoProfile -ExecutionPolicy Bypass -File $sourceAuditTemp -RepoRoot $RepoRoot 2>&1
    $sourceAuditExit = $LASTEXITCODE
} finally { $ErrorActionPreference = $prior }
$sourceAuditConsole = @($sourceAuditOutput | ForEach-Object { [string]$_ })
$sourceAuditConsole | Set-Content -Path (Join-Path $outDir 'source_audit_console.txt') -Encoding UTF8

# Build a completely separate clean worktree from origin/main. This only adds
# worktree metadata to .git and writes the new shadow directory; live source
# files are not modified.
$shadowRoot = Join-Path $ShadowParent "MILES_ENTERPRISE_SHADOW_$stamp"
if (Test-Path $shadowRoot) { throw "Shadow path already exists: $shadowRoot" }
$worktreeAdd = Invoke-GitProbe $RepoRoot worktree add --detach $shadowRoot origin/main
if ($worktreeAdd.exit_code -ne 0) { throw "Unable to create shadow worktree:`n$($worktreeAdd.output -join "`n")" }

$shadowHeadProbe = Invoke-GitProbe $shadowRoot rev-parse HEAD
if ($shadowHeadProbe.exit_code -ne 0) { throw 'Unable to determine shadow HEAD.' }
$shadowHead = [string]$shadowHeadProbe.output[0]
if ($shadowHead -ne $originMain) { throw "Shadow HEAD mismatch. Expected $originMain, got $shadowHead" }

$shadowStatusProbe = Invoke-GitProbe $shadowRoot status --porcelain=v1
$shadowInitiallyClean = ($shadowStatusProbe.exit_code -eq 0 -and $shadowStatusProbe.output.Count -eq 0)

# Force safety posture for all validation children. Unit tests are local-only;
# production runners are never invoked here.
$env:MILES_DRY_RUN = 'true'
$env:MILES_ALLOW_INSTANTLY_MUTATIONS = 'false'
$env:MILES_AUTONOMOUS_EXECUTE = 'false'
$env:CAPTURE_CAPACITY_AUTO_STAGE = 'false'
$env:MILES_ROOT = $shadowRoot

$syntaxFiles = @(
    'StartMilesProduction.js',
    'StartProductionSystem.js',
    'StartAutonomousCOO.js',
    'StartMiles.js',
    'StartExecutiveDashboard.js',
    'SERVICES/AutonomousCOOLoopService.js',
    'SERVICES/digital_coo/MilesCommandCenter.js',
    'CONNECTORS/INSTANTLY/connector.js',
    'SERVICES/revenue/GlobalSuppressionService.js',
    'SERVICES/revenue/ReplyIntelligenceService.js',
    'SERVICES/revenue/ReplyIntelligenceProductionLoopService.js',
    'SERVICES/revenue/WinBackProspectReconstructionService.js',
    'SERVICES/revenue/WinBackCampaignService.js',
    'SERVICES/revenue/WinBackLocalHistoryDiscoveryService.js',
    'SERVICES/revenue/WinBackProductionLoopService.js',
    'SERVICES/revenue/CaptureCapacityCampaignService.js',
    'SERVICES/revenue/CaptureCapacityProspectDiscoveryService.js',
    'SERVICES/revenue/CaptureCapacitySourceBootstrapService.js',
    'SERVICES/revenue/CaptureCapacityOrionSignalBridgeService.js',
    'SERVICES/revenue/CaptureCapacityProductionLoopService.js',
    'RUN_P2GC_REPLY_INTELLIGENCE.js',
    'RUN_P2GC_WINBACK_CAMPAIGN.js',
    'RUN_CAPTURE_CAPACITY_PROSPECT_DISCOVERY.js',
    'RUN_CAPTURE_CAPACITY_CAMPAIGN.js'
)

$testFiles = @(
    'TESTS/reply_intelligence_classification_test.js',
    'TESTS/reply_intelligence_production_loop_test.js',
    'TESTS/reply_global_suppression_connector_test.js',
    'TESTS/reply_intelligence_production_entrypoint_test.js',
    'TESTS/winback_reconstruction_test.js',
    'TESTS/winback_local_history_test.js',
    'TESTS/winback_crossgen_messaging_test.js',
    'TESTS/winback_master_export_test.js',
    'TESTS/winback_production_loop_test.js',
    'TESTS/winback_production_entrypoint_test.js',
    'TESTS/winback_campaign_test.js',
    'TESTS/capture_capacity_autonomous_execution_test.js',
    'TESTS/capture_capacity_runtime_routing_test.js',
    'TESTS/capture_capacity_source_bootstrap_test.js',
    'TESTS/capture_capacity_orion_signal_bridge_test.js',
    'TESTS/capture_capacity_production_loop_test.js',
    'TESTS/capture_capacity_production_entrypoint_test.js'
)

$syntaxResults = @()
foreach ($file in $syntaxFiles) { $syntaxResults += Invoke-NodeCheck $shadowRoot $file }

$testResults = @()
foreach ($file in $testFiles) { $testResults += Invoke-NodeTest $shadowRoot $file }

$shadowFinalStatusProbe = Invoke-GitProbe $shadowRoot status --porcelain=v1
$shadowFinalStatus = if ($shadowFinalStatusProbe.exit_code -eq 0) { @($shadowFinalStatusProbe.output) } else { @("STATUS_FAILED") }

$syntaxPassed = @($syntaxResults | Where-Object ok).Count
$testsPassed = @($testResults | Where-Object ok).Count
$syntaxFailed = @($syntaxResults | Where-Object { -not $_.ok })
$testsFailed = @($testResults | Where-Object { -not $_.ok })
$stageOk = ($sourceAuditExit -eq 0 -and $shadowInitiallyClean -and $syntaxFailed.Count -eq 0 -and $testsFailed.Count -eq 0)

$report = [ordered]@{
    generated_at = (Get-Date).ToUniversalTime().ToString('o')
    stage = 'MILES_RECONCILIATION_STAGE1'
    ok = $stageOk
    live_repository = $RepoRoot
    live_checkout_modified = $false
    origin_main = $originMain
    source_audit_exit_code = $sourceAuditExit
    source_audit_console_file = (Join-Path $outDir 'source_audit_console.txt')
    shadow_root = $shadowRoot
    shadow_head = $shadowHead
    shadow_initially_clean = $shadowInitiallyClean
    syntax_total = $syntaxResults.Count
    syntax_passed = $syntaxPassed
    syntax_failed = $syntaxFailed
    tests_total = $testResults.Count
    tests_passed = $testsPassed
    tests_failed = $testsFailed
    shadow_final_status = $shadowFinalStatus
    safety = [ordered]@{
        env_loaded = $false
        production_started = $false
        outbound_network_runner_invoked = $false
        instantly_mutations_allowed = $false
        autonomous_execution_allowed = $false
        live_merge_used = $false
        live_rebase_used = $false
        live_reset_used = $false
        live_clean_used = $false
    }
    next_action = if ($stageOk) {
        'Use the live-source reconciliation manifest to select only P0/P1 preserve candidates for shadow overlay and validation.'
    } else {
        'Do not cut over. Review failed syntax/tests and source reconciliation output first.'
    }
}

$jsonPath = Join-Path $outDir 'miles_reconciliation_stage1.json'
$textPath = Join-Path $outDir 'miles_reconciliation_stage1.txt'
$report | ConvertTo-Json -Depth 12 | Set-Content -Path $jsonPath -Encoding UTF8

$summary = @(
    'MILES RECONCILIATION STAGE 1',
    "OK: $stageOk",
    "origin/main: $originMain",
    "Live checkout modified: False",
    "Source audit exit: $sourceAuditExit",
    "Shadow root: $shadowRoot",
    "Shadow HEAD: $shadowHead",
    "Shadow initially clean: $shadowInitiallyClean",
    "Syntax: $syntaxPassed/$($syntaxResults.Count) passed",
    "Tests: $testsPassed/$($testResults.Count) passed",
    "Shadow final status entries: $($shadowFinalStatus.Count)",
    '',
    'SYNTAX FAILURES:',
    (($syntaxFailed | Select-Object path,exit_code,output | Format-List | Out-String).TrimEnd()),
    '',
    'TEST FAILURES:',
    (($testsFailed | Select-Object path,exit_code,output | Format-List | Out-String).TrimEnd()),
    '',
    "JSON REPORT: $jsonPath",
    "SOURCE AUDIT CONSOLE: $($report.source_audit_console_file)",
    '',
    "NEXT ACTION: $($report.next_action)"
)
$summary | Set-Content -Path $textPath -Encoding UTF8

Write-Host ''
Write-Host "Stage 1 OK: $stageOk"
Write-Host "origin/main: $originMain"
Write-Host "Live checkout modified: False"
Write-Host "Shadow root: $shadowRoot"
Write-Host "Syntax: $syntaxPassed/$($syntaxResults.Count) passed"
Write-Host "Tests: $testsPassed/$($testResults.Count) passed"
Write-Host ''
Write-Host 'Source reconciliation summary:'
$sourceAuditConsole | Select-Object -Last 80 | ForEach-Object { Write-Host $_ }
Write-Host ''
if ($syntaxFailed.Count -gt 0) {
    Write-Host 'Syntax failures:'
    $syntaxFailed | Select-Object path,exit_code | Format-Table -AutoSize
}
if ($testsFailed.Count -gt 0) {
    Write-Host 'Test failures:'
    $testsFailed | Select-Object path,exit_code | Format-Table -AutoSize
}
Write-Host 'Reports:'
Write-Host "  $jsonPath"
Write-Host "  $textPath"
Write-Host "  $($report.source_audit_console_file)"
Write-Host ''
Write-Host "NEXT ACTION: $($report.next_action)"

if (-not $stageOk) { exit 2 }
exit 0
