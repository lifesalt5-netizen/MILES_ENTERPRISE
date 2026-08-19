param(
    [Parameter(Mandatory=$true)][string]$CandidateRoot,
    [string]$LiveRoot = "C:\P2GC_Intelligence\MILES_ENTERPRISE",
    [Parameter(Mandatory=$true)][string]$ExpectedCommit,
    [int]$TimeoutSeconds = 120
)

$ErrorActionPreference = "Stop"
$ports = @(3000,8787,3737,8737)
$nodePattern = 'StartMilesProduction|StartProductionSystem|StartProductionSystemRehearsal|StartAutonomousCOO|MilesCommandCenter|StartMiles\.js|StartExecutiveDashboard|StartMilesRehearsal'

function Get-GitValue([string]$Root,[string[]]$GitArgs) {
    $output = & git -C $Root @GitArgs 2>$null
    if ($LASTEXITCODE -ne 0) { throw "Git command failed: git -C $Root $($GitArgs -join ' ')" }
    return @($output | ForEach-Object { [string]$_ })
}

function Get-PortRows {
    $rows = @()
    foreach ($port in $ports) {
        $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
        $rows += [pscustomobject]@{
            port = $port
            listening = ($listeners.Count -gt 0)
            pids = @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)
        }
    }
    return $rows
}

function Get-MilesNodeProcesses {
    try {
        return @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
            [string]$_.CommandLine -match $nodePattern
        } | ForEach-Object {
            [pscustomobject]@{
                pid = [int]$_.ProcessId
                command_line = [string]$_.CommandLine
            }
        })
    } catch {
        return @()
    }
}

function Stop-MilesNodes {
    $processes = @(Get-MilesNodeProcesses)
    foreach ($process in $processes) {
        try { Stop-Process -Id $process.pid -Force -ErrorAction SilentlyContinue } catch {}
    }
    return $processes
}

function Wait-PortState([bool]$Listening,[int]$TimeoutSec) {
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    do {
        $rows = @(Get-PortRows)
        $matches = @($rows | Where-Object { $_.listening -eq $Listening }).Count
        if ($matches -eq $ports.Count) { return $rows }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    throw "Timed out waiting for canonical ports to become listening=$Listening"
}

function Start-NodeRuntime([string]$Root,[string]$Entry,[string]$Stdout,[string]$Stderr) {
    $node = (Get-Command node -ErrorAction Stop).Source
    return Start-Process -FilePath $node `
        -ArgumentList @((Join-Path $Root $Entry)) `
        -WorkingDirectory $Root `
        -RedirectStandardOutput $Stdout `
        -RedirectStandardError $Stderr `
        -PassThru
}

function Wait-RehearsalReady([string]$StatusFile,[datetime]$StartedAt,[int]$TimeoutSec) {
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    do {
        if (Test-Path -LiteralPath $StatusFile -PathType Leaf) {
            try {
                $item = Get-Item -LiteralPath $StatusFile
                if ($item.LastWriteTime -ge $StartedAt.AddSeconds(-1)) {
                    $status = Get-Content -Raw -LiteralPath $StatusFile | ConvertFrom-Json
                    if ($status.ok -eq $true -and $status.startupComplete -eq $true) {
                        return $status
                    }
                }
            } catch {}
        }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    throw "Candidate rehearsal did not reach production-bootstrap readiness within $TimeoutSec seconds."
}

if (-not (Test-Path -LiteralPath $CandidateRoot -PathType Container)) { throw "Candidate root not found: $CandidateRoot" }
if (-not (Test-Path -LiteralPath $LiveRoot -PathType Container)) { throw "Live root not found: $LiveRoot" }
if (-not (Test-Path -LiteralPath (Join-Path $CandidateRoot 'StartMilesRehearsal.js') -PathType Leaf)) { throw 'StartMilesRehearsal.js is missing.' }
if (-not (Test-Path -LiteralPath (Join-Path $CandidateRoot 'StartProductionSystemRehearsal.js') -PathType Leaf)) { throw 'StartProductionSystemRehearsal.js is missing.' }

$head = (Get-GitValue $CandidateRoot @('rev-parse','HEAD'))[0]
if ($head -ne $ExpectedCommit) { throw "Candidate HEAD mismatch. Expected $ExpectedCommit, found $head" }
$status = @(Get-GitValue $CandidateRoot @('status','--porcelain=v1','--untracked-files=all'))
if ($status.Count -ne 0) { throw "Candidate must be clean before rehearsal. Found $($status.Count) status entries." }

$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$outDir = Join-Path $env:TEMP "MILES_CUTOVER_REHEARSAL_$stamp"
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
$rehearsalOut = Join-Path $outDir 'candidate_stdout.log'
$rehearsalErr = Join-Path $outDir 'candidate_stderr.log'
$restoreOut = Join-Path $outDir 'live_restore_stdout.log'
$restoreErr = Join-Path $outDir 'live_restore_stderr.log'
$auditOut = Join-Path $outDir 'candidate_acceptance_output.txt'
$reportPath = Join-Path $outDir 'miles_cutover_rehearsal.json'

$liveEnv = Join-Path $LiveRoot '.env'
$candidateEnv = Join-Path $CandidateRoot '.env'
$candidateEnvBackup = Join-Path $outDir 'candidate_env_original.backup'
$hadCandidateEnv = Test-Path -LiteralPath $candidateEnv -PathType Leaf
if ($hadCandidateEnv) { Copy-Item -LiteralPath $candidateEnv -Destination $candidateEnvBackup -Force }

$initialNodes = @(Get-MilesNodeProcesses)
$initialPorts = @(Get-PortRows)
$liveWasRunning = (@($initialPorts | Where-Object listening).Count -gt 0)
$rehearsalReady = $false
$acceptanceReady = $false
$restoreReady = $false
$acceptanceReport = $null
$failure = $null

Write-Host '============================================================'
Write-Host 'MILES CONTROLLED CUTOVER REHEARSAL'
Write-Host '============================================================'
Write-Host "Candidate: $CandidateRoot"
Write-Host "Live:      $LiveRoot"
Write-Host "Commit:    $ExpectedCommit"
Write-Host 'Safety: candidate runs with task execution, autonomous work generation, workflow queueing, controlled writes, and Instantly writes disabled.'
Write-Host 'The current live runtime is automatically restored after the rehearsal.'

try {
    if (Test-Path -LiteralPath $liveEnv -PathType Leaf) {
        Copy-Item -LiteralPath $liveEnv -Destination $candidateEnv -Force
    }

    Write-Host ''
    Write-Host 'Stopping current MILES runtime for the rehearsal window...'
    $stopped = @(Stop-MilesNodes)
    Wait-PortState $false 30 | Out-Null

    $startedAt = Get-Date
    Write-Host 'Starting validated candidate in zero-execution rehearsal mode...'
    $rehearsalProcess = Start-NodeRuntime $CandidateRoot 'StartMilesRehearsal.js' $rehearsalOut $rehearsalErr
    $statusFile = Join-Path $CandidateRoot 'DATA\runtime\production_bootstrap_status.json'
    $bootstrapStatus = Wait-RehearsalReady $statusFile $startedAt $TimeoutSeconds
    Wait-PortState $true 30 | Out-Null
    $rehearsalReady = $true

    Write-Host 'Candidate runtime READY. Running production acceptance against the candidate...'
    $auditScript = Join-Path $CandidateRoot 'SCRIPTS\AUDIT_MILES_PRODUCTION_ACCEPTANCE.ps1'
    $auditStarted = Get-Date
    $auditText = & powershell -NoProfile -ExecutionPolicy Bypass -File $auditScript -Root $CandidateRoot 2>&1
    @($auditText | ForEach-Object { [string]$_ }) | Set-Content -LiteralPath $auditOut -Encoding UTF8

    $acceptanceDir = Get-ChildItem -LiteralPath $env:TEMP -Directory -Filter 'MILES_PRODUCTION_ACCEPTANCE_*' -ErrorAction SilentlyContinue |
        Where-Object { $_.LastWriteTime -ge $auditStarted.AddSeconds(-2) } |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
    if (-not $acceptanceDir) { throw 'Candidate acceptance report directory was not produced.' }
    $acceptanceJson = Join-Path $acceptanceDir.FullName 'miles_production_acceptance.json'
    if (-not (Test-Path -LiteralPath $acceptanceJson -PathType Leaf)) { throw 'Candidate acceptance JSON was not produced.' }
    $acceptanceReport = Get-Content -Raw -LiteralPath $acceptanceJson | ConvertFrom-Json
    $acceptanceReady = [bool]$acceptanceReport.ready_for_daily_use
    if (-not $acceptanceReady) {
        throw "Candidate production acceptance reported hard blockers: $(@($acceptanceReport.hard_blockers) -join ', ')"
    }
}
catch {
    $failure = $_.Exception.Message
}
finally {
    Write-Host ''
    Write-Host 'Stopping rehearsal candidate...'
    Stop-MilesNodes | Out-Null
    try { Wait-PortState $false 30 | Out-Null } catch {}

    if ($hadCandidateEnv -and (Test-Path -LiteralPath $candidateEnvBackup -PathType Leaf)) {
        Copy-Item -LiteralPath $candidateEnvBackup -Destination $candidateEnv -Force
    } else {
        Remove-Item -LiteralPath $candidateEnv -Force -ErrorAction SilentlyContinue
    }

    if ($liveWasRunning) {
        Write-Host 'Restoring prior live MILES runtime...'
        try {
            $restoreProcess = Start-NodeRuntime $LiveRoot 'StartMilesProduction.js' $restoreOut $restoreErr
            Wait-PortState $true $TimeoutSeconds | Out-Null
            $restoreReady = $true
        } catch {
            $restoreReady = $false
            if (-not $failure) { $failure = "LIVE_RESTORE_FAILED: $($_.Exception.Message)" }
        }
    } else {
        $restoreReady = $true
    }
}

$report = [ordered]@{
    generated_at = (Get-Date).ToUniversalTime().ToString('o')
    rehearsal = 'MILES_CONTROLLED_CUTOVER_REHEARSAL'
    candidate_root = $CandidateRoot
    live_root = $LiveRoot
    expected_commit = $ExpectedCommit
    candidate_head = $head
    initial_live_nodes = $initialNodes
    initial_ports = $initialPorts
    live_was_running = $liveWasRunning
    candidate_bootstrap_ready = $rehearsalReady
    candidate_acceptance_ready_for_daily_use = $acceptanceReady
    candidate_acceptance_hard_blockers = if($acceptanceReport){@($acceptanceReport.hard_blockers)}else{@()}
    candidate_acceptance_warnings = if($acceptanceReport){@($acceptanceReport.warnings)}else{@()}
    prior_live_runtime_restored = $restoreReady
    failure = $failure
    safety = [ordered]@{
        candidate_worker_task_execution_enabled = $false
        candidate_autonomous_work_generation_enabled = $false
        candidate_autonomous_workflow_queueing_enabled = $false
        candidate_controlled_writes_enabled = $false
        candidate_instantly_writes_enabled = $false
        production_source_files_migrated = $false
        github_modified_by_rehearsal = $false
    }
    evidence = [ordered]@{
        candidate_stdout = $rehearsalOut
        candidate_stderr = $rehearsalErr
        candidate_acceptance_output = $auditOut
        live_restore_stdout = $restoreOut
        live_restore_stderr = $restoreErr
    }
    rehearsal_passed = ($rehearsalReady -and $acceptanceReady -and $restoreReady -and -not $failure)
}
$report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $reportPath -Encoding UTF8

Write-Host ''
Write-Host "Candidate bootstrap ready: $rehearsalReady"
Write-Host "Candidate acceptance ready: $acceptanceReady"
Write-Host "Prior live runtime restored: $restoreReady"
Write-Host "Rehearsal passed: $($report.rehearsal_passed)"
if ($failure) { Write-Host "Failure: $failure" }
Write-Host "Report: $reportPath"
Write-Host "Candidate log: $rehearsalOut"
Write-Host "Candidate errors: $rehearsalErr"
Write-Host "Acceptance output: $auditOut"

if (-not $report.rehearsal_passed) { exit 1 }
exit 0
