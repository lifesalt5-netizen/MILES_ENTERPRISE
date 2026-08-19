param(
    [string]$RepoRoot = "C:\P2GC_Intelligence\MILES_ENTERPRISE",
    [int]$MaxExportBytes = 2097152
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
        } finally { Pop-Location }
    } finally { $ErrorActionPreference = $prior }
    return [pscustomobject]@{
        exit_code = $code
        output = @($output | ForEach-Object { [string]$_ })
    }
}

function Normalize-RepoPath([string]$PathValue) {
    if (-not $PathValue) { return "" }
    return ($PathValue -replace '\\','/').TrimStart('./')
}

function Test-HistoricalCopyPath([string]$PathValue) {
    $p = Normalize-RepoPath $PathValue
    if (-not $p) { return $true }
    if ($p -match '(?i)(?:^|/)(?:BACKUPS?|ARCHIVE|_ARCHIVE|LEGACY)(?:/|$)') { return $true }
    if ($p -match '(?i)\.BEFORE[_\.-]') { return $true }
    if ($p -match '(?i)\.(?:bak|backup|old|orig)(?:[_\.-]|$)') { return $true }
    if ($p -match '(?i)(?:^|/)BUILD(?:S|\d|_|-)') { return $true }
    return $false
}

function Test-SensitiveManifestOnly([string]$PathValue) {
    $p = Normalize-RepoPath $PathValue
    if ($p -match '(?i)^CONFIG/') { return $true }
    if ($p -match '(?i)(?:^|/)(?:\.env|credentials?|secrets?|tokens?)(?:\.|/|$)') { return $true }
    return $false
}

function Redact-LikelySecrets([string]$Text) {
    if ($null -eq $Text) { return "" }
    $pattern = '(?i)(api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|passwd|secret|token)\s*[:=]\s*(["''])([^"'']{6,})(["''])'
    return [regex]::Replace($Text, $pattern, {
        param($match)
        return "$($match.Groups[1].Value) = `"[REDACTED_BY_STAGE2]`""
    })
}

function Get-Sha256([string]$FilePath) {
    if (-not (Test-Path -LiteralPath $FilePath -PathType Leaf)) { return "" }
    return (Get-FileHash -Algorithm SHA256 -LiteralPath $FilePath).Hash.ToLowerInvariant()
}

function Invoke-NodeSyntaxCheck([string]$FilePath) {
    if (-not (Test-Path -LiteralPath $FilePath -PathType Leaf)) {
        return [pscustomobject]@{ checked=$false; ok=$false; exit_code=-1; output='FILE_MISSING' }
    }
    $prior = $ErrorActionPreference
    try {
        $ErrorActionPreference = "Continue"
        $output = & node --check $FilePath 2>&1
        $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = $prior }
    return [pscustomobject]@{
        checked = $true
        ok = ($code -eq 0)
        exit_code = $code
        output = ($output -join "`n")
    }
}

if (-not (Test-Path $RepoRoot)) { throw "Live MILES repository not found: $RepoRoot" }
if (-not (Test-Path (Join-Path $RepoRoot '.git'))) { throw "Not a Git working copy: $RepoRoot" }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'git.exe not found in PATH' }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'node.exe not found in PATH' }

Write-Host "============================================================"
Write-Host "MILES RECONCILIATION STAGE 2 - PRESERVE CANDIDATE EXPORT"
Write-Host "============================================================"
Write-Host "Live repository: $RepoRoot"
Write-Host "Purpose: export only P0/P1 local preserve candidates for semantic review."
Write-Host "Live source files will only be read and syntax-checked."
Write-Host "No production process, campaign runner, or outbound action will be started."

$fetch = Invoke-GitProbe $RepoRoot fetch origin main
if ($fetch.exit_code -ne 0) { throw "git fetch origin main failed:`n$($fetch.output -join "`n")" }
$originProbe = Invoke-GitProbe $RepoRoot rev-parse origin/main
if ($originProbe.exit_code -ne 0) { throw 'origin/main could not be resolved.' }
$originMain = [string]$originProbe.output[0]

$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$outDir = Join-Path $env:TEMP "MILES_RECONCILIATION_STAGE2_$stamp"
$bundleDir = Join-Path $outDir 'review_bundle'
$liveDir = Join-Path $bundleDir 'live'
$remoteDir = Join-Path $bundleDir 'remote'
$diffDir = Join-Path $bundleDir 'diff'
New-Item -ItemType Directory -Path $liveDir,$remoteDir,$diffDir -Force | Out-Null

# Re-run the current read-only source reconciliation directly from origin/main so
# the candidate list reflects the latest canonical remote blobs.
$auditScript = Join-Path $outDir 'AUDIT_MILES_LIVE_SOURCE_RECONCILIATION.ps1'
$showAudit = Invoke-GitProbe $RepoRoot show 'origin/main:SCRIPTS/AUDIT_MILES_LIVE_SOURCE_RECONCILIATION.ps1'
if ($showAudit.exit_code -ne 0) { throw 'Unable to read source reconciliation audit from origin/main.' }
$showAudit.output | Set-Content -Path $auditScript -Encoding UTF8

$auditStart = Get-Date
$prior = $ErrorActionPreference
try {
    $ErrorActionPreference = "Continue"
    $auditConsole = & powershell -NoProfile -ExecutionPolicy Bypass -File $auditScript -RepoRoot $RepoRoot 2>&1
    $auditExit = $LASTEXITCODE
} finally { $ErrorActionPreference = $prior }
$auditConsole = @($auditConsole | ForEach-Object { [string]$_ })
$auditConsole | Set-Content -Path (Join-Path $outDir 'source_audit_console.txt') -Encoding UTF8
if ($auditExit -ne 0) { throw "Source reconciliation audit failed with exit code $auditExit" }

$manifestFile = Get-ChildItem -Path $env:TEMP -Directory -Filter 'MILES_SOURCE_RECONCILIATION_*' -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -ge $auditStart.AddSeconds(-2) } |
    Sort-Object LastWriteTime -Descending |
    ForEach-Object { Join-Path $_.FullName 'miles_live_source_reconciliation.json' } |
    Where-Object { Test-Path $_ -PathType Leaf } |
    Select-Object -First 1
if (-not $manifestFile) {
    $manifestFile = Get-ChildItem -Path $env:TEMP -Directory -Filter 'MILES_SOURCE_RECONCILIATION_*' -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        ForEach-Object { Join-Path $_.FullName 'miles_live_source_reconciliation.json' } |
        Where-Object { Test-Path $_ -PathType Leaf } |
        Select-Object -First 1
}
if (-not $manifestFile) { throw 'Unable to locate source reconciliation manifest.' }

$sourceManifest = Get-Content -Raw -LiteralPath $manifestFile | ConvertFrom-Json
$allowedClasses = @('P0_RUNTIME_ENTRYPOINT','P0_REVENUE','P1_CONNECTOR','P1_CONFIG','P1_RUNTIME_SOURCE')
$allowedStates = @('COMMITTED_LOCAL_DELTA','WORKTREE_LOCAL_DELTA','LOCAL_ONLY_SOURCE')
$allowedRecommendations = @('REVIEW_PRESERVE_CANDIDATE','REVIEW_LOCAL_ONLY_SOURCE')

$candidates = @($sourceManifest.source_rows | Where-Object {
    $allowedClasses -contains [string]$_.class -and
    $allowedStates -contains [string]$_.state -and
    $allowedRecommendations -contains [string]$_.recommendation -and
    -not (Test-HistoricalCopyPath ([string]$_.path))
})

$rows = @()
foreach ($candidate in $candidates) {
    $repoPath = Normalize-RepoPath ([string]$candidate.path)
    $livePath = Join-Path $RepoRoot ($repoPath -replace '/','\')
    $liveExists = Test-Path -LiteralPath $livePath -PathType Leaf
    $stat = if ($liveExists) { Get-Item -LiteralPath $livePath } else { $null }
    $manifestOnly = Test-SensitiveManifestOnly $repoPath
    $tooLarge = [bool]($stat -and $stat.Length -gt $MaxExportBytes)
    $contentExported = $false
    $liveExport = ''
    $remoteExport = ''
    $diffExport = ''
    $remoteExists = $false
    $remoteBlob = [string]$candidate.origin_main_blob

    $syntax = if ($liveExists -and $repoPath -match '(?i)\.js$') {
        Invoke-NodeSyntaxCheck $livePath
    } else {
        [pscustomobject]@{ checked=$false; ok=$true; exit_code=0; output='' }
    }

    if ($liveExists -and -not $manifestOnly -and -not $tooLarge) {
        $liveExport = Join-Path $liveDir ($repoPath -replace '/','\')
        New-Item -ItemType Directory -Path (Split-Path -Parent $liveExport) -Force | Out-Null
        $liveText = Get-Content -Raw -LiteralPath $livePath -ErrorAction Stop
        Redact-LikelySecrets $liveText | Set-Content -LiteralPath $liveExport -Encoding UTF8
        $contentExported = $true

        $showRemote = Invoke-GitProbe $RepoRoot show "origin/main:$repoPath"
        if ($showRemote.exit_code -eq 0) {
            $remoteExists = $true
            $remoteExport = Join-Path $remoteDir ($repoPath -replace '/','\')
            New-Item -ItemType Directory -Path (Split-Path -Parent $remoteExport) -Force | Out-Null
            Redact-LikelySecrets ($showRemote.output -join "`n") | Set-Content -LiteralPath $remoteExport -Encoding UTF8

            $safeName = ($repoPath -replace '[\\/:*?"<>|]','__') + '.diff.txt'
            $diffExport = Join-Path $diffDir $safeName
            $prior = $ErrorActionPreference
            try {
                $ErrorActionPreference = 'Continue'
                $diffOutput = & git diff --no-index --unified=3 -- $remoteExport $liveExport 2>&1
                $diffExit = $LASTEXITCODE
            } finally { $ErrorActionPreference = $prior }
            if ($diffExit -in @(0,1)) {
                @($diffOutput | ForEach-Object { [string]$_ }) | Set-Content -LiteralPath $diffExport -Encoding UTF8
            } else {
                "DIFF_FAILED exit=$diffExit" | Set-Content -LiteralPath $diffExport -Encoding UTF8
            }
        }
    }

    $rows += [pscustomobject]@{
        path = $repoPath
        class = [string]$candidate.class
        state = [string]$candidate.state
        recommendation = [string]$candidate.recommendation
        running_entrypoint = [bool]$candidate.running_entrypoint
        in_local_checkpoint_commit = [bool]$candidate.in_local_checkpoint_commit
        in_worktree_change = [bool]$candidate.in_worktree_change
        untracked_source = [bool]$candidate.untracked_source
        local_commits = [string]$candidate.local_commits
        live_exists = $liveExists
        size_bytes = if ($stat) { [long]$stat.Length } else { 0 }
        live_sha256 = if ($liveExists) { Get-Sha256 $livePath } else { '' }
        origin_main_blob = $remoteBlob
        remote_exists = $remoteExists
        syntax_checked = [bool]$syntax.checked
        syntax_ok = [bool]$syntax.ok
        syntax_exit_code = [int]$syntax.exit_code
        manifest_only_sensitive = $manifestOnly
        too_large_for_export = $tooLarge
        content_exported = $contentExported
        live_export = if ($liveExport) { $liveExport.Substring($outDir.Length).TrimStart('\') } else { '' }
        remote_export = if ($remoteExport) { $remoteExport.Substring($outDir.Length).TrimStart('\') } else { '' }
        diff_export = if ($diffExport) { $diffExport.Substring($outDir.Length).TrimStart('\') } else { '' }
    }
}

$manifestCsv = Join-Path $bundleDir 'stage2_preserve_candidates.csv'
$manifestJson = Join-Path $bundleDir 'stage2_preserve_candidates.json'
$rows | Export-Csv -NoTypeInformation -Encoding UTF8 -LiteralPath $manifestCsv

$syntaxFailures = @($rows | Where-Object { $_.syntax_checked -and -not $_.syntax_ok })
$exported = @($rows | Where-Object content_exported)
$manifestOnly = @($rows | Where-Object manifest_only_sensitive)
$localOnly = @($rows | Where-Object { $_.state -eq 'LOCAL_ONLY_SOURCE' })
$p0 = @($rows | Where-Object { $_.class -match '^P0' })
$p1 = @($rows | Where-Object { $_.class -match '^P1' })

$report = [ordered]@{
    generated_at = (Get-Date).ToUniversalTime().ToString('o')
    stage = 'MILES_RECONCILIATION_STAGE2_EXPORT'
    ok = ($auditExit -eq 0 -and $syntaxFailures.Count -eq 0)
    live_repository = $RepoRoot
    live_checkout_modified = $false
    origin_main = $originMain
    source_manifest = $manifestFile
    candidate_count = $rows.Count
    p0_count = $p0.Count
    p1_count = $p1.Count
    local_only_count = $localOnly.Count
    exported_content_count = $exported.Count
    sensitive_manifest_only_count = $manifestOnly.Count
    syntax_failure_count = $syntaxFailures.Count
    rows = $rows
    safety = [ordered]@{
        env_loaded = $false
        production_started = $false
        outbound_runner_invoked = $false
        instantly_mutations_allowed = $false
        live_files_written = $false
        live_git_integration_used = $false
        likely_secret_literals_redacted_in_exported_copies = $true
        config_and_sensitive_paths_manifest_only = $true
    }
    next_action = 'Upload the review bundle ZIP so the P0/P1 local source deltas can be semantically reconciled into clean GitHub main before any cutover.'
}
$report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $manifestJson -Encoding UTF8

$readme = @(
    'MILES RECONCILIATION STAGE 2 REVIEW BUNDLE',
    '',
    "Generated: $($report.generated_at)",
    "origin/main: $originMain",
    "Candidates: $($rows.Count)",
    "P0: $($p0.Count)",
    "P1: $($p1.Count)",
    "Local-only: $($localOnly.Count)",
    "Content exported: $($exported.Count)",
    "Sensitive/config manifest-only: $($manifestOnly.Count)",
    "Syntax failures: $($syntaxFailures.Count)",
    '',
    'Safety:',
    '- No live source file was modified.',
    '- No .env was loaded or copied.',
    '- No production process or campaign runner was started.',
    '- Likely secret literal assignments are redacted in exported review copies.',
    '- CONFIG and secret/credential/token-named paths are manifest-only.',
    '',
    'Next action: upload the ZIP for semantic preservation review.'
)
$readme | Set-Content -LiteralPath (Join-Path $bundleDir 'README.txt') -Encoding UTF8

$zipPath = Join-Path $outDir "MILES_STAGE2_PRESERVE_REVIEW_$stamp.zip"
Compress-Archive -Path (Join-Path $bundleDir '*') -DestinationPath $zipPath -CompressionLevel Optimal

Write-Host ''
Write-Host "Stage 2 export OK: $($report.ok)"
Write-Host "origin/main: $originMain"
Write-Host "Live checkout modified: False"
Write-Host "P0 candidates: $($p0.Count)"
Write-Host "P1 candidates: $($p1.Count)"
Write-Host "Local-only candidates: $($localOnly.Count)"
Write-Host "Exported source/diffs: $($exported.Count)"
Write-Host "Sensitive/config manifest-only: $($manifestOnly.Count)"
Write-Host "Syntax failures: $($syntaxFailures.Count)"
Write-Host ''
Write-Host 'Priority candidates:'
$rows | Sort-Object @{Expression={if($_.class -match '^P0'){0}else{1}}},path |
    Select-Object -First 80 path,class,state,syntax_ok,content_exported |
    Format-Table -AutoSize
Write-Host ''
Write-Host "Review ZIP: $zipPath"
Write-Host "Manifest: $manifestJson"
Write-Host ''
Write-Host "NEXT ACTION: $($report.next_action)"

if (-not $report.ok) { exit 2 }
exit 0
