param(
    [string]$RepoRoot = "C:\P2GC_Intelligence\MILES_ENTERPRISE"
)

$ErrorActionPreference = "Stop"

function Invoke-GitProbe {
    param([Parameter(ValueFromRemainingArguments=$true)][string[]]$Args)
    $prior = $ErrorActionPreference
    try {
        $ErrorActionPreference = "Continue"
        $output = & git @Args 2>&1
        $code = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $prior
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

function Normalize-RepoPath([string]$PathValue) {
    if (-not $PathValue) { return "" }
    return ($PathValue -replace '\\','/').TrimStart('./')
}

function Test-ReconciliationSourcePath([string]$PathValue) {
    $p = Normalize-RepoPath $PathValue
    if (-not $p) { return $false }

    if ($p -match '^(BACKUPS?|ARCHIVE|_ARCHIVE|REFERENCE|REFERENCES|MILES_RECOVERY|_REGISTRY_CONVERGENCE_|node_modules|coverage|dist|tmp|temp)/') { return $false }
    if ($p -match '^BUILD(?:S|\d|_|-)' -or $p -match '/BUILD(?:S|\d|_|-)') { return $false }
    if ($p -match '^DATA/(runtime|logs|queue|queues|work_packages|workforce_runtime|autonomous_repair)/') { return $false }
    if ($p -match '^runtime/developer_intelligence/') { return $false }

    if ($p -match '^(CORE|SERVICES|CONNECTORS|PROVIDERS|CONFIG|SCRIPTS|TESTS|WORKERS|DEPARTMENTS)/') { return $true }
    if ($p -match '^(Start|RUN_|AutonomousCOOLoopService|TaskQueue|ExecutionService|ProviderRegistry|BuildEnterpriseRegistry|MilesCommandCenter)') { return $true }
    if ($p -match '^(package\.json|package-lock\.json|\.env\.example|README\.md)$') { return $true }
    return $false
}

function Get-SourceClass([string]$PathValue, [string[]]$CriticalPaths) {
    $p = Normalize-RepoPath $PathValue
    if ($CriticalPaths -contains $p -or $p -match '^Start.*\.js$') { return "P0_RUNTIME_ENTRYPOINT" }
    if ($p -match '^SERVICES/revenue/' -or $p -match 'Revenue|Instantly|Marketing|Sales') { return "P0_REVENUE" }
    if ($p -match '^CONNECTORS/') { return "P1_CONNECTOR" }
    if ($p -match '^CONFIG/') { return "P1_CONFIG" }
    if ($p -match '^(CORE|SERVICES|PROVIDERS|WORKERS)/') { return "P1_RUNTIME_SOURCE" }
    if ($p -match '^TESTS/') { return "P2_TEST" }
    if ($p -match '^SCRIPTS/') { return "P2_SCRIPT" }
    return "P2_OTHER_SOURCE"
}

function Get-BlobSha([string]$Ref, [string]$RepoPath) {
    if (-not $RepoPath) { return "" }
    $probe = Invoke-GitProbe rev-parse "$Ref`:$RepoPath"
    if ($probe.exit_code -ne 0) { return "" }
    return First-Line $probe.output
}

function Get-WorktreeBlobSha([string]$RepoPath) {
    $full = Join-Path $RepoRoot ($RepoPath -replace '/','\')
    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { return "" }
    $probe = Invoke-GitProbe hash-object -- $full
    if ($probe.exit_code -ne 0) { return "" }
    return First-Line $probe.output
}

if (-not (Test-Path $RepoRoot)) { throw "MILES repository not found: $RepoRoot" }
Set-Location $RepoRoot
if (-not (Test-Path (Join-Path $RepoRoot '.git'))) { throw "Not a Git working copy: $RepoRoot" }

Write-Host "============================================================"
Write-Host "MILES LIVE SOURCE RECONCILIATION AUDIT - READ ONLY"
Write-Host "============================================================"
Write-Host "Repository: $RepoRoot"
Write-Host "Purpose: isolate executable/config source deltas; ignore build/archive/runtime debris."
Write-Host "No live checkout integration action will be performed."

$prior = $ErrorActionPreference
try {
    $ErrorActionPreference = "Continue"
    $fetchOutput = & git fetch origin main 2>&1
    $fetchExit = $LASTEXITCODE
} finally {
    $ErrorActionPreference = $prior
}
if ($fetchExit -ne 0) { Write-Warning "git fetch origin main failed; cached origin/main will be used." }

$head = First-Line (Invoke-GitText rev-parse HEAD)
$originMain = First-Line (Invoke-GitText rev-parse origin/main)
$branch = First-Line (Invoke-GitText branch --show-current)
$mergeBaseProbe = Invoke-GitProbe merge-base HEAD origin/main
$historiesRelated = [bool]($mergeBaseProbe.exit_code -eq 0 -and (First-Line $mergeBaseProbe.output))

$criticalPaths = @(
    'StartMilesProduction.js',
    'StartProductionSystem.js',
    'StartAutonomousCOO.js',
    'StartMiles.js',
    'StartExecutiveDashboard.js',
    'AutonomousCOOLoopService.js',
    'SERVICES/AutonomousCOOLoopService.js',
    'CORE/Supervisor.js',
    'CORE/ConnectorManager.js',
    'CORE/TaskQueue.js',
    'SERVICES/digital_coo/MilesCommandCenter.js',
    'CONNECTORS/INSTANTLY/connector.js',
    'CONNECTORS/ORION/connector.js',
    'SERVICES/revenue/CaptureCapacityProductionLoopService.js',
    'SERVICES/revenue/WinBackProductionLoopService.js',
    'SERVICES/revenue/ReplyIntelligenceProductionLoopService.js',
    'SERVICES/revenue/ReplyIntelligenceService.js',
    'SERVICES/revenue/GlobalSuppressionService.js',
    'SERVICES/revenue/CaptureCapacitySourceBootstrapService.js',
    'SERVICES/revenue/WinBackLocalHistoryDiscoveryService.js',
    'RUN_P2GC_REPLY_INTELLIGENCE.js',
    'RUN_P2GC_WINBACK_CAMPAIGN.js',
    'RUN_CAPTURE_CAPACITY_PROSPECT_DISCOVERY.js',
    'RUN_CAPTURE_CAPACITY_CAMPAIGN.js'
)

$localCommitRows = @()
$localCommitProbe = Invoke-GitProbe log '--format=%H|%aI|%an|%s' origin/main..HEAD
if ($localCommitProbe.exit_code -eq 0) {
    foreach ($line in $localCommitProbe.output) {
        if (-not $line) { continue }
        $parts = $line -split '\|',4
        $localCommitRows += [pscustomobject]@{
            sha = $parts[0]
            authored = if ($parts.Count -gt 1) { $parts[1] } else { '' }
            author = if ($parts.Count -gt 2) { $parts[2] } else { '' }
            subject = if ($parts.Count -gt 3) { $parts[3] } else { '' }
        }
    }
}

$commitPathToCommits = @{}
foreach ($commit in $localCommitRows) {
    $filesProbe = Invoke-GitProbe diff-tree --root --no-commit-id --name-only -r $commit.sha
    if ($filesProbe.exit_code -ne 0) { continue }
    foreach ($rawPath in $filesProbe.output) {
        $p = Normalize-RepoPath $rawPath
        if (-not (Test-ReconciliationSourcePath $p)) { continue }
        if (-not $commitPathToCommits.ContainsKey($p)) { $commitPathToCommits[$p] = @() }
        $commitPathToCommits[$p] += "$($commit.sha.Substring(0,8)) $($commit.subject)"
    }
}

$worktreePaths = @()
foreach ($args in @(@('diff','--name-only','HEAD'), @('diff','--cached','--name-only'))) {
    $probe = Invoke-GitProbe @args
    if ($probe.exit_code -ne 0) { continue }
    foreach ($rawPath in $probe.output) {
        $p = Normalize-RepoPath $rawPath
        if (Test-ReconciliationSourcePath $p) { $worktreePaths += $p }
    }
}

$untrackedSourcePaths = @()
$untrackedProbe = Invoke-GitProbe ls-files --others --exclude-standard
if ($untrackedProbe.exit_code -eq 0) {
    foreach ($rawPath in $untrackedProbe.output) {
        $p = Normalize-RepoPath $rawPath
        if (Test-ReconciliationSourcePath $p) { $untrackedSourcePaths += $p }
    }
}

$nodeProcesses = @()
$runningScriptPaths = @()
try {
    $nodeProcesses = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ForEach-Object {
        $cmd = [string]$_.CommandLine
        $relativeScripts = @()
        if ($cmd) {
            $matches = [regex]::Matches($cmd, '(?i)(?:"([^"]+\.js)"|([^\s"]+\.js))')
            foreach ($match in $matches) {
                $candidate = if ($match.Groups[1].Success) { $match.Groups[1].Value } else { $match.Groups[2].Value }
                try {
                    $fullCandidate = [System.IO.Path]::GetFullPath($candidate)
                    $fullRoot = [System.IO.Path]::GetFullPath($RepoRoot).TrimEnd('\') + '\'
                    if ($fullCandidate.StartsWith($fullRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
                        $rel = Normalize-RepoPath $fullCandidate.Substring($fullRoot.Length)
                        if (Test-ReconciliationSourcePath $rel) {
                            $relativeScripts += $rel
                            $runningScriptPaths += $rel
                        }
                    }
                } catch {}
            }
        }
        [pscustomobject]@{
            process_id = $_.ProcessId
            command_line = $cmd
            likely_miles = [bool]($cmd -match 'MILES|StartAutonomousCOO|StartMiles|P2GC')
            repo_scripts = @($relativeScripts | Sort-Object -Unique)
        }
    })
} catch {
    $nodeProcesses = @([pscustomobject]@{ error = $_.Exception.Message })
}

$candidateSet = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
foreach ($p in $criticalPaths) { [void]$candidateSet.Add((Normalize-RepoPath $p)) }
foreach ($p in $commitPathToCommits.Keys) { [void]$candidateSet.Add($p) }
foreach ($p in $worktreePaths) { [void]$candidateSet.Add($p) }
foreach ($p in $untrackedSourcePaths) { [void]$candidateSet.Add($p) }
foreach ($p in $runningScriptPaths) { [void]$candidateSet.Add($p) }

$rows = @()
foreach ($p in @($candidateSet | Sort-Object)) {
    if (-not (Test-ReconciliationSourcePath $p)) { continue }
    $localHeadBlob = Get-BlobSha 'HEAD' $p
    $remoteBlob = Get-BlobSha 'origin/main' $p
    $workBlob = Get-WorktreeBlobSha $p
    $full = Join-Path $RepoRoot ($p -replace '/','\')
    $workExists = Test-Path -LiteralPath $full -PathType Leaf

    $state = if ($workExists -and $remoteBlob -and $workBlob -eq $remoteBlob) {
        'IDENTICAL_TO_REMOTE'
    } elseif ($workExists -and $remoteBlob -and $workBlob -eq $localHeadBlob -and $localHeadBlob -ne $remoteBlob) {
        'COMMITTED_LOCAL_DELTA'
    } elseif ($workExists -and $remoteBlob -and $workBlob -ne $remoteBlob) {
        'WORKTREE_LOCAL_DELTA'
    } elseif ($workExists -and -not $remoteBlob) {
        'LOCAL_ONLY_SOURCE'
    } elseif (-not $workExists -and $remoteBlob) {
        'REMOTE_ONLY_SOURCE'
    } else {
        'UNRESOLVED'
    }

    $sourceClass = Get-SourceClass $p $criticalPaths
    $inCommit = $commitPathToCommits.ContainsKey($p)
    $inWorktree = $worktreePaths -contains $p
    $isUntracked = $untrackedSourcePaths -contains $p
    $isRunning = $runningScriptPaths -contains $p
    $recommendation = switch ($state) {
        'IDENTICAL_TO_REMOTE' { 'NO_PRESERVE_NEEDED' }
        'REMOTE_ONLY_SOURCE' { 'USE_REMOTE_IN_SHADOW' }
        'COMMITTED_LOCAL_DELTA' { if ($sourceClass -match '^P0|^P1') { 'REVIEW_PRESERVE_CANDIDATE' } else { 'REVIEW_LOCAL_DELTA' } }
        'WORKTREE_LOCAL_DELTA' { if ($sourceClass -match '^P0|^P1') { 'REVIEW_PRESERVE_CANDIDATE' } else { 'REVIEW_WORKTREE_DELTA' } }
        'LOCAL_ONLY_SOURCE' { 'REVIEW_LOCAL_ONLY_SOURCE' }
        default { 'MANUAL_REVIEW' }
    }

    $rows += [pscustomobject]@{
        path = $p
        class = $sourceClass
        state = $state
        recommendation = $recommendation
        running_entrypoint = $isRunning
        in_local_checkpoint_commit = $inCommit
        in_worktree_change = $inWorktree
        untracked_source = $isUntracked
        local_head_blob = $localHeadBlob
        worktree_blob = $workBlob
        origin_main_blob = $remoteBlob
        local_commits = if ($inCommit) { ($commitPathToCommits[$p] -join ' || ') } else { '' }
    }
}

$preserveCandidates = @($rows | Where-Object { $_.recommendation -match '^REVIEW_PRESERVE_CANDIDATE$|^REVIEW_LOCAL_ONLY_SOURCE$' })
$p0Deltas = @($rows | Where-Object { $_.class -match '^P0' -and $_.state -ne 'IDENTICAL_TO_REMOTE' })
$p1Deltas = @($rows | Where-Object { $_.class -match '^P1' -and $_.state -ne 'IDENTICAL_TO_REMOTE' })
$runningDeltas = @($rows | Where-Object { $_.running_entrypoint -and $_.state -ne 'IDENTICAL_TO_REMOTE' })

$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$outDir = Join-Path $env:TEMP "MILES_SOURCE_RECONCILIATION_$stamp"
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
$jsonPath = Join-Path $outDir 'miles_live_source_reconciliation.json'
$csvPath = Join-Path $outDir 'miles_live_source_reconciliation.csv'
$textPath = Join-Path $outDir 'miles_live_source_reconciliation.txt'

$rows | Export-Csv -NoTypeInformation -Encoding UTF8 -Path $csvPath

$report = [ordered]@{
    generated_at = (Get-Date).ToUniversalTime().ToString('o')
    safety_mode = 'READ_ONLY_SOURCE_RECONCILIATION'
    repository_root = $RepoRoot
    branch = $branch
    head = $head
    origin_main = $originMain
    histories_related = $historiesRelated
    local_checkpoint_commits = $localCommitRows
    candidate_source_count = $rows.Count
    p0_delta_count = $p0Deltas.Count
    p1_delta_count = $p1Deltas.Count
    preserve_candidate_count = $preserveCandidates.Count
    running_entrypoint_delta_count = $runningDeltas.Count
    untracked_source_candidate_count = @($rows | Where-Object untracked_source).Count
    source_rows = $rows
    node_processes = $nodeProcesses
    safety = [ordered]@{
        live_checkout_modified = $false
        merge_used = $false
        rebase_used = $false
        reset_used = $false
        checkout_used = $false
        clean_used = $false
        source_files_copied = $false
    }
    next_action = 'Review only P0/P1 preserve candidates, then validate selected deltas in a separate origin/main shadow worktree. Do not merge unrelated histories.'
}
$report | ConvertTo-Json -Depth 12 | Set-Content -Path $jsonPath -Encoding UTF8

$summary = @(
    'MILES LIVE SOURCE RECONCILIATION',
    "Generated: $($report.generated_at)",
    "HEAD: $head",
    "origin/main: $originMain",
    "Histories related: $historiesRelated",
    "Local checkpoint commits: $($localCommitRows.Count)",
    "Candidate executable/config source files: $($rows.Count)",
    "P0 source deltas: $($p0Deltas.Count)",
    "P1 source deltas: $($p1Deltas.Count)",
    "Preserve candidates: $($preserveCandidates.Count)",
    "Running entrypoint deltas: $($runningDeltas.Count)",
    "Untracked source candidates: $($report.untracked_source_candidate_count)",
    '',
    'P0 DELTAS:',
    (($p0Deltas | Select-Object path,state,recommendation,local_commits | Format-Table -AutoSize | Out-String).TrimEnd()),
    '',
    'RUNNING ENTRYPOINT DELTAS:',
    (($runningDeltas | Select-Object path,state,recommendation | Format-Table -AutoSize | Out-String).TrimEnd()),
    '',
    'TOP PRESERVE CANDIDATES:',
    (($preserveCandidates | Select-Object -First 100 path,class,state,recommendation,local_commits | Format-Table -AutoSize | Out-String).TrimEnd()),
    '',
    "JSON REPORT: $jsonPath",
    "CSV REPORT: $csvPath"
)
$summary | Set-Content -Path $textPath -Encoding UTF8

Write-Host ''
Write-Host "Local checkpoint commits: $($localCommitRows.Count)"
Write-Host "Candidate executable/config source files: $($rows.Count)"
Write-Host "P0 source deltas: $($p0Deltas.Count)"
Write-Host "P1 source deltas: $($p1Deltas.Count)"
Write-Host "Preserve candidates: $($preserveCandidates.Count)"
Write-Host "Running entrypoint deltas: $($runningDeltas.Count)"
Write-Host "Untracked source candidates: $($report.untracked_source_candidate_count)"
Write-Host ''
Write-Host 'P0 source deltas:'
$p0Deltas | Select-Object -First 100 path,state,recommendation | Format-Table -AutoSize
Write-Host ''
Write-Host 'Running entrypoint deltas:'
$runningDeltas | Select-Object path,state,recommendation | Format-Table -AutoSize
Write-Host ''
Write-Host 'Reports:'
Write-Host "  $jsonPath"
Write-Host "  $csvPath"
Write-Host "  $textPath"
Write-Host ''
Write-Host 'NEXT ACTION: review P0/P1 preserve candidates in a separate shadow runtime. Live checkout remains untouched.'

exit 0
