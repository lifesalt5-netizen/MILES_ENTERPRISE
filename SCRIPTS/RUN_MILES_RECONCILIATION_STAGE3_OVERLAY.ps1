param(
    [Parameter(Mandatory=$true)][string]$DecisionManifest,
    [Parameter(Mandatory=$true)][string]$Stage2Manifest,
    [string]$LiveRoot = "C:\P2GC_Intelligence\MILES_ENTERPRISE",
    [Parameter(Mandatory=$true)][string]$ShadowRoot
)

$ErrorActionPreference = "Stop"

function Normalize-RepoPath([string]$PathValue) {
    if (-not $PathValue) { return "" }
    return ($PathValue -replace '\\','/').TrimStart('./')
}

function Get-Sha256([string]$FilePath) {
    if (-not (Test-Path -LiteralPath $FilePath -PathType Leaf)) { return "" }
    return (Get-FileHash -Algorithm SHA256 -LiteralPath $FilePath).Hash.ToLowerInvariant()
}

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
        } finally { Pop-Location }
    } finally { $ErrorActionPreference = $prior }
    return [pscustomobject]@{ exit_code=$code; output=@($output | ForEach-Object { [string]$_ }) }
}

function Invoke-NodeCheck([string]$WorkingDirectory,[string]$RelativePath) {
    $full = Join-Path $WorkingDirectory ($RelativePath -replace '/','\')
    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) {
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

function Invoke-NodeTest([string]$WorkingDirectory,[string]$RelativePath) {
    $full = Join-Path $WorkingDirectory ($RelativePath -replace '/','\')
    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) {
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

function Test-SensitivePath([string]$RepoPath) {
    $p = Normalize-RepoPath $RepoPath
    if ($p -match '(?i)^CONFIG/') { return $true }
    if ($p -match '(?i)(?:^|/)(?:\.env|credentials?|secrets?|tokens?)(?:\.|/|$)') { return $true }
    return $false
}

if (-not (Test-Path -LiteralPath $LiveRoot -PathType Container)) { throw "Live root not found: $LiveRoot" }
if (-not (Test-Path -LiteralPath $ShadowRoot -PathType Container)) { throw "Shadow root not found: $ShadowRoot" }
if (-not (Test-Path -LiteralPath (Join-Path $ShadowRoot '.git'))) { throw "Shadow root is not a Git worktree: $ShadowRoot" }
if (-not (Test-Path -LiteralPath $DecisionManifest -PathType Leaf)) { throw "Decision manifest not found: $DecisionManifest" }
if (-not (Test-Path -LiteralPath $Stage2Manifest -PathType Leaf)) { throw "Stage 2 manifest not found: $Stage2Manifest" }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'node.exe not found in PATH' }

$stage2 = Get-Content -Raw -LiteralPath $Stage2Manifest | ConvertFrom-Json
$decisionsDoc = Get-Content -Raw -LiteralPath $DecisionManifest | ConvertFrom-Json
$decisions = @($decisionsDoc.decisions)
if ($decisions.Count -eq 0) { throw 'Decision manifest contains no decisions.' }

$shadowHeadProbe = Invoke-GitProbe $ShadowRoot rev-parse HEAD
if ($shadowHeadProbe.exit_code -ne 0) { throw 'Unable to resolve shadow HEAD.' }
$shadowHead = [string]$shadowHeadProbe.output[0]
$expectedBase = [string]$decisionsDoc.expected_origin_main
if (-not $expectedBase) { $expectedBase = [string]$stage2.origin_main }
if (-not $expectedBase) { throw 'No expected origin/main commit supplied by Stage 2 or decision manifest.' }
if ($shadowHead -ne $expectedBase) {
    throw "Shadow HEAD changed since review. Expected $expectedBase, got $shadowHead. Create a fresh validated shadow or regenerate decisions."
}

$stage2Rows = @{}
foreach ($row in @($stage2.rows)) {
    $p = Normalize-RepoPath ([string]$row.path)
    if ($p) { $stage2Rows[$p.ToLowerInvariant()] = $row }
}

$allowedActions = @('KEEP_LOCAL','USE_REMOTE','RETIRE','MERGED_SOURCE')
$applyRows = @()
$blocking = @()
foreach ($decision in $decisions) {
    $repoPath = Normalize-RepoPath ([string]$decision.path)
    $action = ([string]$decision.action).ToUpperInvariant()
    if (-not $repoPath) { $blocking += [pscustomobject]@{ path=''; reason='EMPTY_PATH' }; continue }
    if ($allowedActions -notcontains $action) { $blocking += [pscustomobject]@{ path=$repoPath; reason="INVALID_ACTION:$action" }; continue }

    $key = $repoPath.ToLowerInvariant()
    if (-not $stage2Rows.ContainsKey($key)) { $blocking += [pscustomobject]@{ path=$repoPath; reason='NOT_IN_STAGE2_MANIFEST' }; continue }
    $candidate = $stage2Rows[$key]
    if ([string]$candidate.class -notmatch '^P0|^P1') { $blocking += [pscustomobject]@{ path=$repoPath; reason='NOT_P0_P1' }; continue }
    if ([bool]$candidate.manifest_only_sensitive -or (Test-SensitivePath $repoPath)) {
        if ($action -notin @('USE_REMOTE','RETIRE')) {
            $blocking += [pscustomobject]@{ path=$repoPath; reason='SENSITIVE_AUTOMATIC_OVERLAY_BLOCKED' }
            continue
        }
    }

    $sourcePath = ''
    $expectedSha = [string]$candidate.live_sha256
    if ($action -eq 'KEEP_LOCAL') {
        $sourcePath = Join-Path $LiveRoot ($repoPath -replace '/','\')
        if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
            $blocking += [pscustomobject]@{ path=$repoPath; reason='LIVE_SOURCE_MISSING' }; continue
        }
        $currentSha = Get-Sha256 $sourcePath
        if (-not $expectedSha -or $currentSha -ne $expectedSha.ToLowerInvariant()) {
            $blocking += [pscustomobject]@{ path=$repoPath; reason='LIVE_HASH_CHANGED_SINCE_STAGE2'; expected=$expectedSha; current=$currentSha }
            continue
        }
    } elseif ($action -eq 'MERGED_SOURCE') {
        $sourcePath = [string]$decision.merged_source_path
        if (-not $sourcePath -or -not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
            $blocking += [pscustomobject]@{ path=$repoPath; reason='MERGED_SOURCE_MISSING' }; continue
        }
        $expectedMergedSha = ([string]$decision.expected_merged_sha256).ToLowerInvariant()
        $currentMergedSha = Get-Sha256 $sourcePath
        if (-not $expectedMergedSha -or $currentMergedSha -ne $expectedMergedSha) {
            $blocking += [pscustomobject]@{ path=$repoPath; reason='MERGED_SOURCE_HASH_MISMATCH'; expected=$expectedMergedSha; current=$currentMergedSha }
            continue
        }
    }

    $applyRows += [pscustomobject]@{
        path=$repoPath
        action=$action
        source_path=$sourcePath
        class=[string]$candidate.class
        reviewed_live_sha256=$expectedSha
        rationale=[string]$decision.rationale
    }
}

if ($blocking.Count -gt 0) {
    Write-Host 'Stage 3 blocked before overlay. No shadow files were changed.'
    $blocking | Format-Table -AutoSize
    exit 3
}

# Force non-production posture for validation children. No production runner is invoked.
$env:MILES_DRY_RUN = 'true'
$env:MILES_ALLOW_INSTANTLY_MUTATIONS = 'false'
$env:MILES_AUTONOMOUS_EXECUTE = 'false'
$env:CAPTURE_CAPACITY_AUTO_STAGE = 'false'
$env:MILES_ROOT = $ShadowRoot

$preStatus = Invoke-GitProbe $ShadowRoot status --porcelain=v1
if ($preStatus.exit_code -ne 0) { throw 'Unable to inspect shadow status.' }
if ($preStatus.output.Count -ne 0) {
    throw "Shadow is not clean before Stage 3 overlay. Preserve/review existing changes first.`n$($preStatus.output -join "`n")"
}

$applied = @()
foreach ($row in $applyRows) {
    $dest = Join-Path $ShadowRoot ($row.path -replace '/','\')
    switch ($row.action) {
        'KEEP_LOCAL' {
            New-Item -ItemType Directory -Path (Split-Path -Parent $dest) -Force | Out-Null
            Copy-Item -LiteralPath $row.source_path -Destination $dest -Force
            $applied += [pscustomobject]@{ path=$row.path; action=$row.action; destination_sha256=(Get-Sha256 $dest) }
        }
        'MERGED_SOURCE' {
            New-Item -ItemType Directory -Path (Split-Path -Parent $dest) -Force | Out-Null
            Copy-Item -LiteralPath $row.source_path -Destination $dest -Force
            $applied += [pscustomobject]@{ path=$row.path; action=$row.action; destination_sha256=(Get-Sha256 $dest) }
        }
        'USE_REMOTE' {
            $applied += [pscustomobject]@{ path=$row.path; action=$row.action; destination_sha256=(Get-Sha256 $dest) }
        }
        'RETIRE' {
            # RETIRE means do not import local-only code. If the canonical shadow already has a file, leave it untouched.
            $applied += [pscustomobject]@{ path=$row.path; action=$row.action; destination_sha256=(Get-Sha256 $dest) }
        }
    }
}

$syntaxTargets = @($applied | Where-Object { $_.path -match '(?i)\.js$' -and $_.action -in @('KEEP_LOCAL','MERGED_SOURCE') } | Select-Object -ExpandProperty path -Unique)
$syntaxResults = @()
foreach ($path in $syntaxTargets) { $syntaxResults += Invoke-NodeCheck $ShadowRoot $path }

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
$testResults = @()
foreach ($file in $testFiles) { $testResults += Invoke-NodeTest $ShadowRoot $file }

$syntaxFailed = @($syntaxResults | Where-Object { -not $_.ok })
$testsFailed = @($testResults | Where-Object { -not $_.ok })
$postStatus = Invoke-GitProbe $ShadowRoot status --porcelain=v1
$stageOk = ($syntaxFailed.Count -eq 0 -and $testsFailed.Count -eq 0 -and $postStatus.exit_code -eq 0)

$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$outDir = Join-Path $env:TEMP "MILES_RECONCILIATION_STAGE3_$stamp"
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
$jsonPath = Join-Path $outDir 'miles_reconciliation_stage3.json'
$textPath = Join-Path $outDir 'miles_reconciliation_stage3.txt'

$report = [ordered]@{
    generated_at=(Get-Date).ToUniversalTime().ToString('o')
    stage='MILES_RECONCILIATION_STAGE3_GATED_OVERLAY'
    ok=$stageOk
    live_root=$LiveRoot
    live_checkout_modified=$false
    shadow_root=$ShadowRoot
    shadow_base=$shadowHead
    decision_manifest=$DecisionManifest
    stage2_manifest=$Stage2Manifest
    decision_count=$decisions.Count
    applied=$applied
    syntax_total=$syntaxResults.Count
    syntax_passed=@($syntaxResults | Where-Object ok).Count
    syntax_failed=$syntaxFailed
    tests_total=$testResults.Count
    tests_passed=@($testResults | Where-Object ok).Count
    tests_failed=$testsFailed
    shadow_status=@($postStatus.output)
    safety=[ordered]@{
        live_source_written=$false
        shadow_only_overlay=$true
        hash_gate_enforced=$true
        stage2_membership_gate_enforced=$true
        p0_p1_gate_enforced=$true
        sensitive_automatic_overlay_blocked=$true
        env_loaded=$false
        production_started=$false
        outbound_runner_invoked=$false
        instantly_mutations_allowed=$false
    }
    next_action=if($stageOk){'Review the validated shadow diff. Only then create a GitHub integration branch from canonical main and port approved changes.'}else{'Do not integrate or cut over. Review Stage 3 syntax/test failures and adjust the decision/merged source set.'}
}
$report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $jsonPath -Encoding UTF8

$summary=@(
    'MILES RECONCILIATION STAGE 3',
    "OK: $stageOk",
    "Live checkout modified: False",
    "Shadow: $ShadowRoot",
    "Shadow base: $shadowHead",
    "Decisions: $($decisions.Count)",
    "Applied/retained: $($applied.Count)",
    "Syntax: $($report.syntax_passed)/$($report.syntax_total) passed",
    "Tests: $($report.tests_passed)/$($report.tests_total) passed",
    "Shadow status entries: $(@($postStatus.output).Count)",
    '',
    'APPLIED DECISIONS:',
    (($applied | Format-Table -AutoSize | Out-String).TrimEnd()),
    '',
    'SYNTAX FAILURES:',
    (($syntaxFailed | Format-List | Out-String).TrimEnd()),
    '',
    'TEST FAILURES:',
    (($testsFailed | Format-List | Out-String).TrimEnd()),
    '',
    "JSON REPORT: $jsonPath",
    "NEXT ACTION: $($report.next_action)"
)
$summary | Set-Content -LiteralPath $textPath -Encoding UTF8

Write-Host ''
Write-Host "Stage 3 OK: $stageOk"
Write-Host "Live checkout modified: False"
Write-Host "Shadow: $ShadowRoot"
Write-Host "Decisions: $($decisions.Count)"
Write-Host "Syntax: $($report.syntax_passed)/$($report.syntax_total) passed"
Write-Host "Tests: $($report.tests_passed)/$($report.tests_total) passed"
Write-Host "Shadow status entries: $(@($postStatus.output).Count)"
Write-Host ''
Write-Host 'Reports:'
Write-Host "  $jsonPath"
Write-Host "  $textPath"
Write-Host ''
Write-Host "NEXT ACTION: $($report.next_action)"

if (-not $stageOk) { exit 2 }
exit 0
