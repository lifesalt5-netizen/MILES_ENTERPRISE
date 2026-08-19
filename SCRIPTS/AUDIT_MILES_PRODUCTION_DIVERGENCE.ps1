param(
    [string]$RepoRoot = "C:\P2GC_Intelligence\MILES_ENTERPRISE"
)

$ErrorActionPreference = "Stop"

function Invoke-GitProbe {
    param([Parameter(ValueFromRemainingArguments=$true)][string[]]$Args)

    $previousErrorActionPreference = $ErrorActionPreference
    try {
        # Git may write informational text to stderr even when it succeeds.
        $ErrorActionPreference = "Continue"
        $output = & git @Args 2>&1
        $code = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }

    return [pscustomobject]@{
        exit_code = $code
        output = @($output | ForEach-Object { [string]$_ })
    }
}

function Invoke-GitText {
    param([Parameter(ValueFromRemainingArguments=$true)][string[]]$Args)

    $probe = Invoke-GitProbe @Args
    if ($probe.exit_code -ne 0) {
        throw "git $($Args -join ' ') failed with exit code $($probe.exit_code)`n$($probe.output -join "`n")"
    }
    return @($probe.output)
}

function First-Line([object[]]$Value) {
    if ($null -eq $Value -or $Value.Count -eq 0) { return "" }
    return [string]$Value[0]
}

function Read-JsonSafe([string]$Path) {
    if (-not (Test-Path $Path)) { return $null }
    try {
        return Get-Content -Raw -Path $Path | ConvertFrom-Json
    } catch {
        return [pscustomobject]@{ parse_error = $_.Exception.Message; path = $Path }
    }
}

if (-not (Test-Path $RepoRoot)) {
    throw "MILES repository not found: $RepoRoot"
}

Set-Location $RepoRoot
if (-not (Test-Path (Join-Path $RepoRoot ".git"))) {
    throw "Not a Git working copy: $RepoRoot"
}

Write-Host "============================================================"
Write-Host "MILES PRODUCTION DIVERGENCE AUDIT — READ ONLY"
Write-Host "============================================================"
Write-Host "Repository: $RepoRoot"
Write-Host "No working-tree integration action will be performed."

# Refresh remote metadata only. This does not alter the checked-out files.
$previousErrorActionPreference = $ErrorActionPreference
try {
    $ErrorActionPreference = "Continue"
    $fetchOutput = & git fetch origin main 2>&1
    $fetchExit = $LASTEXITCODE
} finally {
    $ErrorActionPreference = $previousErrorActionPreference
}
if ($fetchExit -ne 0) {
    Write-Warning "git fetch origin main failed; audit will use the currently cached origin/main ref."
}

$branch = First-Line (Invoke-GitText branch --show-current)
$head = First-Line (Invoke-GitText rev-parse HEAD)
$originMain = First-Line (Invoke-GitText rev-parse origin/main)

# A production recovery checkout may legitimately have a different Git lineage
# from the GitHub repository. merge-base returns exit code 1 in that case; that
# is audit evidence, not an audit failure.
$mergeBaseProbe = Invoke-GitProbe merge-base HEAD origin/main
$mergeBase = if ($mergeBaseProbe.exit_code -eq 0) { First-Line $mergeBaseProbe.output } else { "" }
$historiesRelated = [bool]($mergeBaseProbe.exit_code -eq 0 -and $mergeBase)

$aheadBehindRaw = First-Line (Invoke-GitText rev-list --left-right --count HEAD...origin/main)
$aheadBehindParts = @($aheadBehindRaw -split '\s+')
$localAhead = if ($aheadBehindParts.Count -ge 1) { [int]$aheadBehindParts[0] } else { 0 }
$remoteAhead = if ($aheadBehindParts.Count -ge 2) { [int]$aheadBehindParts[1] } else { 0 }

$statusLines = @(Invoke-GitText status --porcelain=v1 --untracked-files=all)
$trackedChanges = @($statusLines | Where-Object { $_ -notmatch '^\?\?' })
$untracked = @($statusLines | Where-Object { $_ -match '^\?\?' })

# Cap displayed commit inventories while retaining exact ahead/behind counts.
$localOnly = @(Invoke-GitText log --oneline --decorate --no-merges --max-count=200 origin/main..HEAD)
$remoteOnly = @(Invoke-GitText log --oneline --decorate --no-merges --max-count=200 HEAD..origin/main)
$headRoots = @(Invoke-GitText rev-list --max-parents=0 HEAD)
$originRoots = @(Invoke-GitText rev-list --max-parents=0 origin/main)
$headDetails = First-Line (Invoke-GitText show -s "--format=%H|%P|%aI|%an|%s" HEAD)
$originDetails = First-Line (Invoke-GitText show -s "--format=%H|%P|%aI|%an|%s" origin/main)
$upstreamProbe = Invoke-GitProbe rev-parse --abbrev-ref --symbolic-full-name "@{u}"
$upstream = if ($upstreamProbe.exit_code -eq 0) { First-Line $upstreamProbe.output } else { "" }
$originUrlProbe = Invoke-GitProbe remote get-url origin
$originUrl = if ($originUrlProbe.exit_code -eq 0) { First-Line $originUrlProbe.output } else { "" }
$remotes = @(Invoke-GitText remote -v)
$worktrees = @(Invoke-GitText worktree list --porcelain)

$revenueFiles = @(
    "RUN_P2GC_REPLY_INTELLIGENCE.js",
    "RUN_P2GC_WINBACK_CAMPAIGN.js",
    "RUN_CAPTURE_CAPACITY_PROSPECT_DISCOVERY.js",
    "RUN_CAPTURE_CAPACITY_CAMPAIGN.js",
    "SCRIPTS\RUN_P2GC_SAFE_REVENUE_AUDIT.ps1",
    "SERVICES\revenue\ReplyIntelligenceProductionLoopService.js",
    "SERVICES\revenue\GlobalSuppressionService.js"
)
$revenueFileStatus = foreach ($relative in $revenueFiles) {
    [pscustomobject]@{
        path = $relative
        present = Test-Path (Join-Path $RepoRoot $relative)
    }
}

$runtimeStatusCandidates = @(
    (Join-Path $RepoRoot "DATA\runtime\production_bootstrap_status.json"),
    (Join-Path $RepoRoot "DATA\runtime\latest_coo_cycle.json"),
    (Join-Path $RepoRoot "DATA\executive\latest_coo_cycle.json")
)
$runtimeArtifacts = foreach ($candidate in $runtimeStatusCandidates) {
    if (Test-Path $candidate) {
        [pscustomobject]@{
            path = $candidate
            last_write_utc = (Get-Item $candidate).LastWriteTimeUtc.ToString("o")
            value = Read-JsonSafe $candidate
        }
    }
}

$nodeProcesses = @()
try {
    $nodeProcesses = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ForEach-Object {
        [pscustomobject]@{
            process_id = $_.ProcessId
            executable = $_.ExecutablePath
            command_line = $_.CommandLine
            likely_miles = [bool]($_.CommandLine -match 'MILES|StartAutonomousCOO|StartMiles|P2GC')
        }
    })
} catch {
    $nodeProcesses = @([pscustomobject]@{ error = $_.Exception.Message })
}

$classification = if (-not $historiesRelated) {
    "UNRELATED_HISTORY"
} elseif ($localAhead -eq 0 -and $remoteAhead -eq 0) {
    "IN_SYNC"
} elseif ($localAhead -gt 0 -and $remoteAhead -gt 0) {
    "DIVERGED"
} elseif ($localAhead -gt 0) {
    "LOCAL_AHEAD_ONLY"
} else {
    "REMOTE_AHEAD_ONLY"
}

$nextAction = switch ($classification) {
    "UNRELATED_HISTORY" { "Local HEAD and origin/main have no common ancestor. Preserve the live checkout exactly as-is. Do NOT merge with --allow-unrelated-histories, rebase, reset, pull, or force-update. Reconcile through a separate integration worktree/branch after reviewing local history and dirty files." }
    "IN_SYNC" { "Repository refs are aligned. Verify runtime root/commit before deployment actions." }
    "REMOTE_AHEAD_ONLY" { "Local branch has no unique commits; review dirty files before considering a fast-forward deployment." }
    "LOCAL_AHEAD_ONLY" { "Local branch contains unique commits; preserve/review them before publishing or integrating." }
    default { "Divergence confirmed. Review local-only commits and dirty files before creating an integration worktree/branch. Do not overwrite the live checkout." }
}

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$outDir = Join-Path $env:TEMP "MILES_PRODUCTION_RECONCILIATION_$stamp"
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
$jsonPath = Join-Path $outDir "miles_production_divergence_audit.json"
$textPath = Join-Path $outDir "miles_production_divergence_audit.txt"

$report = [ordered]@{
    generated_at = (Get-Date).ToUniversalTime().ToString("o")
    safety_mode = "READ_ONLY_WORKTREE_AUDIT"
    repository_root = $RepoRoot
    fetch_origin_main_exit_code = $fetchExit
    branch = $branch
    upstream = $upstream
    origin_url = $originUrl
    head = $head
    head_details = $headDetails
    origin_main = $originMain
    origin_main_details = $originDetails
    histories_related = $historiesRelated
    merge_base = $mergeBase
    merge_base_exit_code = $mergeBaseProbe.exit_code
    head_root_commits = $headRoots
    origin_main_root_commits = $originRoots
    classification = $classification
    local_commits_ahead = $localAhead
    remote_commits_ahead = $remoteAhead
    working_tree_dirty = ($statusLines.Count -gt 0)
    tracked_change_count = $trackedChanges.Count
    untracked_count = $untracked.Count
    tracked_changes = $trackedChanges
    untracked_files = $untracked
    local_only_commits_displayed = $localOnly
    remote_only_commits_displayed = $remoteOnly
    commit_display_limit_each_side = 200
    remotes = $remotes
    worktrees = $worktrees
    revenue_files = $revenueFileStatus
    runtime_artifacts = $runtimeArtifacts
    node_processes = $nodeProcesses
    recommended_next_action = $nextAction
}

$report | ConvertTo-Json -Depth 12 | Set-Content -Path $jsonPath -Encoding UTF8

$summaryLines = @(
    "MILES PRODUCTION DIVERGENCE AUDIT",
    "Generated: $($report.generated_at)",
    "Repository: $RepoRoot",
    "Branch: $branch",
    "Upstream: $upstream",
    "Origin URL: $originUrl",
    "HEAD: $head",
    "HEAD details: $headDetails",
    "origin/main: $originMain",
    "origin/main details: $originDetails",
    "Histories related: $historiesRelated",
    "Merge base exit code: $($mergeBaseProbe.exit_code)",
    "Merge base: $mergeBase",
    "HEAD root commit(s): $($headRoots -join ', ')",
    "origin/main root commit(s): $($originRoots -join ', ')",
    "Classification: $classification",
    "Local-only commits: $localAhead",
    "Remote-only commits: $remoteAhead",
    "Tracked changes: $($trackedChanges.Count)",
    "Untracked files: $($untracked.Count)",
    "",
    "LOCAL-ONLY COMMITS (up to 200 shown):",
    ($localOnly -join "`n"),
    "",
    "REMOTE-ONLY COMMITS (up to 200 shown):",
    ($remoteOnly -join "`n"),
    "",
    "WORKING TREE STATUS:",
    ($statusLines -join "`n"),
    "",
    "RECOMMENDED NEXT ACTION:",
    $nextAction,
    "",
    "JSON REPORT: $jsonPath"
)
$summaryLines | Set-Content -Path $textPath -Encoding UTF8

Write-Host ""
Write-Host "Classification: $classification"
Write-Host "Histories related: $historiesRelated"
Write-Host "Merge base exit code: $($mergeBaseProbe.exit_code)"
Write-Host "HEAD root commit(s): $($headRoots -join ', ')"
Write-Host "origin/main root commit(s): $($originRoots -join ', ')"
Write-Host "Local-only commits: $localAhead"
Write-Host "Remote-only commits: $remoteAhead"
Write-Host "Tracked changes: $($trackedChanges.Count)"
Write-Host "Untracked files: $($untracked.Count)"
Write-Host ""
Write-Host "Recent local-only commits:"
@($localOnly | Select-Object -First 25) | ForEach-Object { Write-Host "  $_" }
Write-Host ""
Write-Host "Working tree status:"
@($statusLines | Select-Object -First 100) | ForEach-Object { Write-Host "  $_" }
if ($statusLines.Count -gt 100) { Write-Host "  ... $($statusLines.Count - 100) additional status lines are in the report." }
Write-Host ""
Write-Host "Recommended next action:"
Write-Host $nextAction
Write-Host ""
Write-Host "Reports:"
Write-Host "  $jsonPath"
Write-Host "  $textPath"

exit 0
