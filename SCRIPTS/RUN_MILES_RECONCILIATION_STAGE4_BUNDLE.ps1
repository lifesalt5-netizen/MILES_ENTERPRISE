param(
    [Parameter(Mandatory=$true)][string]$Stage3Report
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

function Test-LikelyEmbeddedSecret([string]$Text) {
    if ($null -eq $Text) { return $false }
    $patterns = @(
        '(?i)(api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|passwd|secret)\s*[:=]\s*["''][^"'']{10,}["'']',
        '(?i)authorization\s*[:=]\s*["'']bearer\s+[A-Za-z0-9_\-\.]{12,}["'']'
    )
    foreach ($pattern in $patterns) {
        if ([regex]::IsMatch($Text, $pattern)) { return $true }
    }
    return $false
}

if (-not (Test-Path -LiteralPath $Stage3Report -PathType Leaf)) { throw "Stage 3 report not found: $Stage3Report" }
$stage3 = Get-Content -Raw -LiteralPath $Stage3Report | ConvertFrom-Json
if (-not [bool]$stage3.ok) { throw 'Stage 3 report is not OK. Integration bundle is blocked.' }
if ([bool]$stage3.live_checkout_modified) { throw 'Stage 3 indicates live checkout modification. Integration bundle is blocked.' }
if (-not [bool]$stage3.safety.shadow_only_overlay) { throw 'Stage 3 did not certify shadow-only overlay.' }
if ([bool]$stage3.safety.live_source_written) { throw 'Stage 3 indicates live source writes. Integration bundle is blocked.' }

$shadowRoot = [string]$stage3.shadow_root
$shadowBase = [string]$stage3.shadow_base
if (-not $shadowRoot -or -not (Test-Path -LiteralPath $shadowRoot -PathType Container)) { throw "Shadow root not found: $shadowRoot" }
if (-not (Test-Path -LiteralPath (Join-Path $shadowRoot '.git'))) { throw "Shadow is not a Git worktree: $shadowRoot" }

$headProbe = Invoke-GitProbe $shadowRoot rev-parse HEAD
if ($headProbe.exit_code -ne 0) { throw 'Unable to resolve shadow HEAD.' }
$currentHead = [string]$headProbe.output[0]
if ($currentHead -ne $shadowBase) { throw "Shadow HEAD changed after Stage 3. Expected $shadowBase, got $currentHead" }

$approved = @{}
foreach ($row in @($stage3.applied)) {
    $action = ([string]$row.action).ToUpperInvariant()
    if ($action -notin @('KEEP_LOCAL','MERGED_SOURCE')) { continue }
    $p = Normalize-RepoPath ([string]$row.path)
    if (-not $p) { continue }
    $approved[$p.ToLowerInvariant()] = [pscustomobject]@{
        path=$p
        action=$action
        expected_sha256=([string]$row.destination_sha256).ToLowerInvariant()
    }
}
if ($approved.Count -eq 0) { throw 'Stage 3 contains no approved shadow source changes to bundle.' }

$trackedProbe = Invoke-GitProbe $shadowRoot diff --name-only HEAD
if ($trackedProbe.exit_code -ne 0) { throw 'Unable to list shadow tracked changes.' }
$untrackedProbe = Invoke-GitProbe $shadowRoot ls-files --others --exclude-standard
if ($untrackedProbe.exit_code -ne 0) { throw 'Unable to list shadow untracked files.' }
$changedPaths = @($trackedProbe.output + $untrackedProbe.output | ForEach-Object { Normalize-RepoPath $_ } | Where-Object { $_ } | Sort-Object -Unique)
if ($changedPaths.Count -eq 0) { throw 'Shadow has no changed files to bundle.' }

$unexpected = @($changedPaths | Where-Object { -not $approved.ContainsKey($_.ToLowerInvariant()) })
if ($unexpected.Count -gt 0) {
    throw "Shadow contains changes that were not explicitly approved in Stage 3:`n$($unexpected -join "`n")"
}

$missingApproved = @($approved.Values | Where-Object { $changedPaths -notcontains $_.path })
if ($missingApproved.Count -gt 0) {
    throw "Stage 3 approved files are missing from the current shadow diff:`n$(($missingApproved | ForEach-Object path) -join "`n")"
}

$verificationRows = @()
$secretBlocks = @()
foreach ($p in $changedPaths) {
    $meta = $approved[$p.ToLowerInvariant()]
    $full = Join-Path $shadowRoot ($p -replace '/','\')
    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { throw "Approved shadow file missing: $p" }
    $sha = Get-Sha256 $full
    if (-not $meta.expected_sha256 -or $sha -ne $meta.expected_sha256) {
        throw "Approved shadow file hash changed after Stage 3: $p"
    }

    $secretHit = $false
    $extension = [System.IO.Path]::GetExtension($full).ToLowerInvariant()
    if ($extension -in @('.js','.json','.ps1','.md','.txt','.yml','.yaml')) {
        $text = Get-Content -Raw -LiteralPath $full -ErrorAction Stop
        $secretHit = Test-LikelyEmbeddedSecret $text
        if ($secretHit) { $secretBlocks += $p }
    }

    $verificationRows += [pscustomobject]@{
        path=$p
        action=$meta.action
        sha256=$sha
        embedded_secret_pattern_detected=$secretHit
    }
}
if ($secretBlocks.Count -gt 0) {
    throw "Potential embedded secret literal detected. Remove/parameterize before integration:`n$($secretBlocks -join "`n")"
}

$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$outDir = Join-Path $env:TEMP "MILES_RECONCILIATION_STAGE4_$stamp"
$bundleDir = Join-Path $outDir 'integration_bundle'
$filesDir = Join-Path $bundleDir 'files'
New-Item -ItemType Directory -Path $filesDir -Force | Out-Null

foreach ($row in $verificationRows) {
    $source = Join-Path $shadowRoot ($row.path -replace '/','\')
    $dest = Join-Path $filesDir ($row.path -replace '/','\')
    New-Item -ItemType Directory -Path (Split-Path -Parent $dest) -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $dest -Force
}

$diffStatProbe = Invoke-GitProbe $shadowRoot diff --stat HEAD
$diffProbe = Invoke-GitProbe $shadowRoot diff --no-ext-diff --unified=5 HEAD
$diffStat = if ($diffStatProbe.exit_code -eq 0) { @($diffStatProbe.output) } else { @('DIFF_STAT_FAILED') }
$trackedDiff = if ($diffProbe.exit_code -eq 0) { @($diffProbe.output) } else { @('TRACKED_DIFF_FAILED') }
$diffStat | Set-Content -LiteralPath (Join-Path $bundleDir 'tracked_diff_stat.txt') -Encoding UTF8
$trackedDiff | Set-Content -LiteralPath (Join-Path $bundleDir 'tracked_diff.patch') -Encoding UTF8

$manifest = [ordered]@{
    generated_at=(Get-Date).ToUniversalTime().ToString('o')
    stage='MILES_RECONCILIATION_STAGE4_INTEGRATION_BUNDLE'
    ok=$true
    shadow_root=$shadowRoot
    shadow_base=$shadowBase
    stage3_report=$Stage3Report
    changed_file_count=$verificationRows.Count
    files=$verificationRows
    live_checkout_modified=$false
    remote_repository_modified=$false
    safety=[ordered]@{
        stage3_ok_required=$true
        shadow_base_pinned=$true
        only_stage3_approved_files_allowed=$true
        post_stage3_hashes_verified=$true
        embedded_secret_literal_scan_passed=$true
        production_started=$false
        outbound_runner_invoked=$false
        instantly_mutations_allowed=$false
        git_push_performed=$false
        git_merge_performed=$false
    }
    next_action='Upload/review this integration bundle. Create a GitHub integration PR only from the verified file payloads after semantic review.'
}
$manifestPath = Join-Path $bundleDir 'stage4_integration_manifest.json'
$manifest | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
$verificationRows | Export-Csv -NoTypeInformation -Encoding UTF8 -LiteralPath (Join-Path $bundleDir 'stage4_integration_manifest.csv')

$readme=@(
    'MILES RECONCILIATION STAGE 4 - VALIDATED INTEGRATION BUNDLE',
    '',
    "Generated: $($manifest.generated_at)",
    "Shadow base: $shadowBase",
    "Approved changed files: $($verificationRows.Count)",
    '',
    'This bundle was generated only after a successful Stage 3 report.',
    'Every file matches the exact Stage 3 post-overlay SHA-256.',
    'No unapproved shadow change is included.',
    'Potential embedded secret literals are blocked before bundle creation.',
    'No live checkout or GitHub repository was modified by Stage 4.',
    '',
    'Next action: semantic review and GitHub integration PR.'
)
$readme | Set-Content -LiteralPath (Join-Path $bundleDir 'README.txt') -Encoding UTF8

$zipPath = Join-Path $outDir "MILES_STAGE4_INTEGRATION_BUNDLE_$stamp.zip"
Compress-Archive -Path (Join-Path $bundleDir '*') -DestinationPath $zipPath -CompressionLevel Optimal

Write-Host '============================================================'
Write-Host 'MILES RECONCILIATION STAGE 4 - INTEGRATION BUNDLE'
Write-Host '============================================================'
Write-Host 'Stage 4 OK: True'
Write-Host 'Live checkout modified: False'
Write-Host 'GitHub modified: False'
Write-Host "Shadow base: $shadowBase"
Write-Host "Approved changed files: $($verificationRows.Count)"
Write-Host "Integration ZIP: $zipPath"
Write-Host ''
Write-Host "NEXT ACTION: $($manifest.next_action)"

exit 0
