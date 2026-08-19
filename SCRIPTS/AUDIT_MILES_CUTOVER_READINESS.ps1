param(
    [Parameter(Mandatory=$true)][string]$CandidateRoot,
    [string]$LiveRoot = "C:\P2GC_Intelligence\MILES_ENTERPRISE",
    [string]$ExpectedCommit = ""
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
            # Keep benign Git stderr warnings out of machine-readable stdout.
            # Stage 5 parses stdout for HEAD/status truth and must not mistake
            # CRLF/LF warning text for repository state.
            $output = & git @Args 2>$null
            $code = $LASTEXITCODE
        } finally { Pop-Location }
    } finally { $ErrorActionPreference = $prior }
    return [pscustomobject]@{ exit_code=$code; output=@($output | ForEach-Object { [string]$_ }) }
}

function Invoke-NodeCheck([string]$Root,[string]$RelativePath) {
    $full = Join-Path $Root ($RelativePath -replace '/','\')
    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) {
        return [pscustomobject]@{ path=$RelativePath; exists=$false; syntax_ok=$false; exit_code=-1; output='FILE_MISSING' }
    }
    $prior = $ErrorActionPreference
    try {
        $ErrorActionPreference = "Continue"
        Push-Location $Root
        try {
            $output = & node --check $RelativePath 2>&1
            $code = $LASTEXITCODE
        } finally { Pop-Location }
    } finally { $ErrorActionPreference = $prior }
    return [pscustomobject]@{ path=$RelativePath; exists=$true; syntax_ok=($code -eq 0); exit_code=$code; output=($output -join "`n") }
}

function Read-EnvKeyNames([string]$EnvPath) {
    if (-not (Test-Path -LiteralPath $EnvPath -PathType Leaf)) { return @() }
    $keys = @()
    foreach ($line in Get-Content -LiteralPath $EnvPath) {
        $trimmed = [string]$line
        if (-not $trimmed) { continue }
        $trimmed = $trimmed.Trim()
        if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
        if ($trimmed -match '^([A-Za-z_][A-Za-z0-9_]*)\s*=') { $keys += $Matches[1].ToUpperInvariant() }
    }
    return @($keys | Sort-Object -Unique)
}

function Get-ReferencedEnvKeys([string]$Root) {
    $roots = @('CORE','SERVICES','CONNECTORS','PROVIDERS','WORKERS','DEPARTMENTS')
    $files = @()
    foreach ($rel in $roots) {
        $dir = Join-Path $Root $rel
        if (Test-Path -LiteralPath $dir -PathType Container) {
            $files += Get-ChildItem -LiteralPath $dir -Recurse -File -Filter '*.js' -ErrorAction SilentlyContinue
        }
    }
    $files += Get-ChildItem -LiteralPath $Root -File -Filter '*.js' -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match '^(Start|RUN_|AutonomousCOO|TaskQueue|ExecutionService|ProviderRegistry)' }

    $keys = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($file in @($files | Sort-Object FullName -Unique)) {
        try {
            $text = Get-Content -Raw -LiteralPath $file.FullName -ErrorAction Stop
            foreach ($match in [regex]::Matches($text, 'process\.env\.([A-Za-z_][A-Za-z0-9_]*)')) {
                [void]$keys.Add($match.Groups[1].Value.ToUpperInvariant())
            }
            foreach ($match in [regex]::Matches($text, 'process\.env\[["'']([A-Za-z_][A-Za-z0-9_]*)["'']\]')) {
                [void]$keys.Add($match.Groups[1].Value.ToUpperInvariant())
            }
        } catch {}
    }
    return @($keys | Sort-Object)
}

function Get-DirectorySnapshot([string]$PathValue) {
    if (-not (Test-Path -LiteralPath $PathValue -PathType Container)) {
        return [pscustomobject]@{ path=$PathValue; exists=$false; last_write_utc=''; top_level_files=0; top_level_directories=0 }
    }
    $item = Get-Item -LiteralPath $PathValue
    $children = @(Get-ChildItem -LiteralPath $PathValue -Force -ErrorAction SilentlyContinue)
    return [pscustomobject]@{
        path=$PathValue
        exists=$true
        last_write_utc=$item.LastWriteTimeUtc.ToString('o')
        top_level_files=@($children | Where-Object { -not $_.PSIsContainer }).Count
        top_level_directories=@($children | Where-Object PSIsContainer).Count
    }
}

if (-not (Test-Path -LiteralPath $CandidateRoot -PathType Container)) { throw "Candidate root not found: $CandidateRoot" }
if (-not (Test-Path -LiteralPath (Join-Path $CandidateRoot '.git'))) { throw "Candidate is not a Git worktree: $CandidateRoot" }
if (-not (Test-Path -LiteralPath $LiveRoot -PathType Container)) { throw "Live root not found: $LiveRoot" }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'git.exe not found in PATH' }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'node.exe not found in PATH' }

Write-Host '============================================================'
Write-Host 'MILES RECONCILIATION STAGE 5 - CUTOVER READINESS AUDIT'
Write-Host '============================================================'
Write-Host "Candidate: $CandidateRoot"
Write-Host "Live rollback root: $LiveRoot"
Write-Host 'PLAN ONLY: no process stop/start, no file migration, no Git push/merge, no port mutation.'

$headProbe = Invoke-GitProbe $CandidateRoot rev-parse HEAD
if ($headProbe.exit_code -ne 0) { throw 'Unable to resolve candidate HEAD.' }
$candidateHead = [string]$headProbe.output[0]
$statusProbe = Invoke-GitProbe $CandidateRoot status --porcelain=v1 --untracked-files=all
if ($statusProbe.exit_code -ne 0) { throw 'Unable to inspect candidate Git status.' }
$candidateStatus = @($statusProbe.output)
$candidateClean = ($candidateStatus.Count -eq 0)
$commitMatches = (-not $ExpectedCommit -or $candidateHead -eq $ExpectedCommit)

$entrypoints = @(
    'StartMilesProduction.js',
    'StartProductionSystem.js',
    'StartAutonomousCOO.js',
    'SERVICES/digital_coo/MilesCommandCenter.js',
    'StartMiles.js',
    'StartExecutiveDashboard.js'
)
$entrypointChecks = @()
foreach ($entry in $entrypoints) { $entrypointChecks += Invoke-NodeCheck $CandidateRoot $entry }
$entrypointsReady = (@($entrypointChecks | Where-Object { -not $_.exists -or -not $_.syntax_ok }).Count -eq 0)

$packagePath = Join-Path $CandidateRoot 'package.json'
$lockPath = Join-Path $CandidateRoot 'package-lock.json'
$packageExists = Test-Path -LiteralPath $packagePath -PathType Leaf
$lockExists = Test-Path -LiteralPath $lockPath -PathType Leaf
$dependencies = @()
if ($packageExists) {
    try {
        $package = Get-Content -Raw -LiteralPath $packagePath | ConvertFrom-Json
        $dependencies = @($package.dependencies.PSObject.Properties.Name | Sort-Object)
    } catch {}
}
$dependencyRows = @()
foreach ($dependency in $dependencies) {
    $depPath = Join-Path (Join-Path $CandidateRoot 'node_modules') ($dependency -replace '/','\')
    $dependencyRows += [pscustomobject]@{ name=$dependency; installed=(Test-Path -LiteralPath $depPath -PathType Container) }
}
$missingDependencies = @($dependencyRows | Where-Object { -not $_.installed })

$nodeVersion = (& node --version 2>$null)
$npmVersion = ''
if (Get-Command npm -ErrorAction SilentlyContinue) { $npmVersion = (& npm --version 2>$null) }

$referencedEnvKeys = Get-ReferencedEnvKeys $CandidateRoot
$liveEnvPath = Join-Path $LiveRoot '.env'
$liveEnvKeys = Read-EnvKeyNames $liveEnvPath
$processEnvKeys = @(Get-ChildItem Env: | ForEach-Object { $_.Name.ToUpperInvariant() } | Sort-Object -Unique)
$availableKeySet = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
foreach ($key in $liveEnvKeys) { [void]$availableKeySet.Add($key) }
foreach ($key in $processEnvKeys) { [void]$availableKeySet.Add($key) }
$missingReferencedEnvKeys = @($referencedEnvKeys | Where-Object { -not $availableKeySet.Contains($_) })

$ports = @(3000,8787,3737,8737)
$portRows = @()
foreach ($port in $ports) {
    $listeners = @()
    try {
        $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
    } catch {}
    $portRows += [pscustomobject]@{
        port=$port
        listening=($listeners.Count -gt 0)
        owning_process_ids=@($listeners | Select-Object -ExpandProperty OwningProcess -Unique)
    }
}

$nodeProcesses = @()
try {
    $nodeProcesses = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ForEach-Object {
        [pscustomobject]@{
            process_id=$_.ProcessId
            executable=$_.ExecutablePath
            command_line=[string]$_.CommandLine
            likely_miles=[bool]([string]$_.CommandLine -match 'MILES|StartAutonomousCOO|StartMiles|P2GC|StartProductionSystem|MilesCommandCenter|StartExecutiveDashboard')
        }
    })
} catch {
    $nodeProcesses = @([pscustomobject]@{ error=$_.Exception.Message })
}

$runtimeSnapshots = @(
    Get-DirectorySnapshot (Join-Path $LiveRoot 'DATA\runtime'),
    Get-DirectorySnapshot (Join-Path $LiveRoot 'DATA\executive'),
    Get-DirectorySnapshot (Join-Path $LiveRoot 'DATA\revenue'),
    Get-DirectorySnapshot (Join-Path $LiveRoot 'DATA\runtime\revenue')
)

$rollbackReady = (Test-Path -LiteralPath $LiveRoot -PathType Container) -and (Test-Path -LiteralPath (Join-Path $LiveRoot '.git'))
$hardBlockers = @()
if (-not $candidateClean) { $hardBlockers += 'CANDIDATE_GIT_NOT_CLEAN' }
if (-not $commitMatches) { $hardBlockers += 'CANDIDATE_COMMIT_MISMATCH' }
if (-not $entrypointsReady) { $hardBlockers += 'ENTRYPOINT_MISSING_OR_SYNTAX_FAILED' }
if (-not $packageExists) { $hardBlockers += 'PACKAGE_JSON_MISSING' }
if (-not $lockExists) { $hardBlockers += 'PACKAGE_LOCK_MISSING' }
if (-not $rollbackReady) { $hardBlockers += 'ROLLBACK_ROOT_NOT_READY' }

$preCutoverActions = @()
if ($missingDependencies.Count -gt 0) { $preCutoverActions += 'Install canonical dependencies in the candidate with npm ci before launch validation.' }
if ($missingReferencedEnvKeys.Count -gt 0) { $preCutoverActions += 'Review referenced environment-key names absent from live .env/process environment; determine which are required versus optional defaults.' }
$preCutoverActions += 'Prepare a secure environment migration method that preserves values without committing or printing secrets.'
$preCutoverActions += 'Record current live MILES PIDs and port ownership immediately before cutover.'
$preCutoverActions += 'Preserve the current legacy production folder unchanged as rollback until the canonical runtime passes production health checks.'
$preCutoverActions += 'Cutover must verify API 3000, Command Center 8787, Desktop 3737, Dashboard 8737, Autonomous COO, and revenue sidecars before rollback is released.'

$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$outDir = Join-Path $env:TEMP "MILES_RECONCILIATION_STAGE5_$stamp"
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
$jsonPath = Join-Path $outDir 'miles_cutover_readiness.json'
$textPath = Join-Path $outDir 'miles_cutover_readiness.txt'

$report = [ordered]@{
    generated_at=(Get-Date).ToUniversalTime().ToString('o')
    stage='MILES_RECONCILIATION_STAGE5_CUTOVER_READINESS'
    plan_only=$true
    ready_for_controlled_cutover=($hardBlockers.Count -eq 0 -and $missingDependencies.Count -eq 0)
    candidate_root=$CandidateRoot
    candidate_head=$candidateHead
    expected_commit=$ExpectedCommit
    commit_matches_expected=$commitMatches
    candidate_git_clean=$candidateClean
    candidate_git_status=$candidateStatus
    node_version=$nodeVersion
    npm_version=$npmVersion
    package_json_exists=$packageExists
    package_lock_exists=$lockExists
    dependencies=$dependencyRows
    missing_dependencies=@($missingDependencies | Select-Object -ExpandProperty name)
    entrypoints=$entrypointChecks
    referenced_env_key_names=$referencedEnvKeys
    live_env_file_exists=(Test-Path -LiteralPath $liveEnvPath -PathType Leaf)
    live_env_key_names=$liveEnvKeys
    referenced_env_key_names_not_currently_available=$missingReferencedEnvKeys
    ports=$portRows
    node_processes=$nodeProcesses
    live_runtime_directories=$runtimeSnapshots
    rollback_root=$LiveRoot
    rollback_ready=$rollbackReady
    hard_blockers=$hardBlockers
    pre_cutover_actions=$preCutoverActions
    safety=[ordered]@{
        live_files_written=$false
        candidate_files_written=$false
        env_values_read_or_reported=$false
        processes_stopped=$false
        processes_started=$false
        ports_changed=$false
        git_push_performed=$false
        git_merge_performed=$false
        outbound_runner_invoked=$false
        instantly_mutations_allowed=$false
    }
    next_action=if($hardBlockers.Count -eq 0){'Resolve dependency/environment readiness items, then perform a separate explicit-authority cutover rehearsal before any production switch.'}else{'Resolve hard blockers before any cutover rehearsal.'}
}
$report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $jsonPath -Encoding UTF8

$summary=@(
    'MILES RECONCILIATION STAGE 5 - CUTOVER READINESS',
    "Plan only: True",
    "Candidate HEAD: $candidateHead",
    "Candidate clean: $candidateClean",
    "Commit matches expected: $commitMatches",
    "Entrypoints ready: $entrypointsReady",
    "Dependencies installed: $($dependencies.Count - $missingDependencies.Count)/$($dependencies.Count)",
    "Referenced env key names: $($referencedEnvKeys.Count)",
    "Referenced env key names not currently available: $($missingReferencedEnvKeys.Count)",
    "Rollback ready: $rollbackReady",
    "Hard blockers: $($hardBlockers.Count)",
    "Ready for controlled cutover: $($report.ready_for_controlled_cutover)",
    '',
    'HARD BLOCKERS:',
    ($hardBlockers -join "`n"),
    '',
    'PRE-CUTOVER ACTIONS:',
    ($preCutoverActions -join "`n"),
    '',
    "JSON REPORT: $jsonPath",
    "NEXT ACTION: $($report.next_action)"
)
$summary | Set-Content -LiteralPath $textPath -Encoding UTF8

Write-Host ''
Write-Host "Candidate clean: $candidateClean"
Write-Host "Commit matches expected: $commitMatches"
Write-Host "Entrypoints ready: $entrypointsReady"
Write-Host "Dependencies installed: $($dependencies.Count - $missingDependencies.Count)/$($dependencies.Count)"
Write-Host "Referenced env key names not currently available: $($missingReferencedEnvKeys.Count)"
Write-Host "Rollback ready: $rollbackReady"
Write-Host "Hard blockers: $($hardBlockers.Count)"
Write-Host "Ready for controlled cutover: $($report.ready_for_controlled_cutover)"
Write-Host ''
Write-Host 'Reports:'
Write-Host "  $jsonPath"
Write-Host "  $textPath"
Write-Host ''
Write-Host "NEXT ACTION: $($report.next_action)"

exit 0