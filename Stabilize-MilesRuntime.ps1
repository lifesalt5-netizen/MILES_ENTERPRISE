param(
    [string]$MilesRoot = "D:\P2GC_Intelligence\MILES_ENTERPRISE",
    [int]$StaleMinutes = 15,
    [int]$ObservationSeconds = 60
)

$ErrorActionPreference = "Stop"

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "============================================================" -ForegroundColor DarkCyan
    Write-Host $Message -ForegroundColor Cyan
    Write-Host "============================================================" -ForegroundColor DarkCyan
}

function Write-JsonAtomic {
    param(
        [Parameter(Mandatory = $true)] $Data,
        [Parameter(Mandatory = $true)] [string]$Path
    )

    $directory = Split-Path -Parent $Path
    if (-not (Test-Path $directory)) {
        New-Item -ItemType Directory -Force -Path $directory | Out-Null
    }

    $tempPath = "$Path.tmp_$PID_$(Get-Date -Format 'yyyyMMddHHmmssfff')"
    $json = $Data | ConvertTo-Json -Depth 100
    [System.IO.File]::WriteAllText($tempPath, $json, [System.Text.UTF8Encoding]::new($false))
    Copy-Item -Force $tempPath $Path
    Remove-Item -Force $tempPath -ErrorAction SilentlyContinue
}

Write-Step "MILES ENTERPRISE RUNTIME STABILIZATION"

if (-not (Test-Path $MilesRoot)) {
    throw "MILES root not found: $MilesRoot"
}

Set-Location $MilesRoot
$env:MILES_ROOT = $MilesRoot

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$runtimeDir = Join-Path $MilesRoot "runtime"
$backupDir = Join-Path $runtimeDir "stabilization_backups\$timestamp"
$reportPath = Join-Path $runtimeDir "MILES_STABILIZATION_REPORT_$timestamp.json"
$stdoutPath = Join-Path $runtimeDir "MILES_STABILIZATION_STDOUT_$timestamp.log"
$stderrPath = Join-Path $runtimeDir "MILES_STABILIZATION_STDERR_$timestamp.log"

New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null

Write-Step "1. STOPPING EXISTING NODE RUNTIMES"

$nodeProcesses = Get-Process node -ErrorAction SilentlyContinue
if ($nodeProcesses) {
    $nodeProcesses | Stop-Process -Force
    Start-Sleep -Seconds 2
    Write-Host "Stopped $($nodeProcesses.Count) Node process(es)." -ForegroundColor Green
}
else {
    Write-Host "No Node processes were running." -ForegroundColor Yellow
}

Write-Step "2. BACKING UP AUTHORITATIVE RUNTIME FILES"

$filesToBackup = @(
    "DATA\runtime\task_queue.json",
    "CONNECTORS\MILES\connector.js",
    "SERVICES\RepositorySearchService.js",
    "SERVICES\ExecutionService.js",
    "CORE\TaskQueue.js",
    "CORE\Supervisor.js",
    "StartProductionSystem.js",
    "StartMilesProduction.js"
)

$backedUpFiles = @()

foreach ($relativePath in $filesToBackup) {
    $source = Join-Path $MilesRoot $relativePath
    if (Test-Path $source) {
        $destination = Join-Path $backupDir $relativePath
        $destinationDir = Split-Path -Parent $destination
        New-Item -ItemType Directory -Force -Path $destinationDir | Out-Null
        Copy-Item -Force $source $destination
        $backedUpFiles += $relativePath
        Write-Host "Backed up: $relativePath"
    }
}

Write-Step "3. VALIDATING THE TWO VERIFIED EXECUTION REPAIRS"

$connectorPath = Join-Path $MilesRoot "CONNECTORS\MILES\connector.js"
$repositoryPath = Join-Path $MilesRoot "SERVICES\RepositorySearchService.js"

if (-not (Test-Path $connectorPath)) {
    throw "Missing connector file: $connectorPath"
}

if (-not (Test-Path $repositoryPath)) {
    throw "Missing repository search service: $repositoryPath"
}

$connectorText = Get-Content $connectorPath -Raw
$repositoryText = Get-Content $repositoryPath -Raw

$connectorChecks = [ordered]@{
    importsRepositorySearch = $connectorText -match 'RepositorySearchService'
    routesRepositorySearch  = $connectorText -match 'REPOSITORY_SEARCH'
    exposesExecute          = $connectorText -match 'async\s+execute\s*\('
    stillImportsBuilder     = $connectorText -match 'AutonomousCapabilityBuilderService'
}

$repositoryChecks = [ordered]@{
    exposesRun              = $repositoryText -match '\brun\s*\('
    exposesExecute          = $repositoryText -match '\bexecute\s*=' -or $repositoryText -match 'async\s+execute\s*\('
    supportsRepositorySearch = $repositoryText -match 'REPOSITORY_SEARCH'
}

$connectorChecks.GetEnumerator() | ForEach-Object {
    $status = if ($_.Value) { "PASS" } else { "FAIL" }
    Write-Host ("Connector {0}: {1}" -f $_.Key, $status)
}

$repositoryChecks.GetEnumerator() | ForEach-Object {
    $status = if ($_.Value) { "PASS" } else { "FAIL" }
    Write-Host ("Repository {0}: {1}" -f $_.Key, $status)
}

if ($connectorChecks.Values -contains $false) {
    throw "The MILES connector does not contain all required routing elements. Restore or replace it before continuing."
}

if ($repositoryChecks.Values -contains $false) {
    throw "RepositorySearchService does not contain the required execution contract."
}

Write-Step "4. RUNNING JAVASCRIPT SYNTAX CHECKS"

$syntaxFiles = @(
    "CONNECTORS\MILES\connector.js",
    "SERVICES\RepositorySearchService.js",
    "SERVICES\ExecutionService.js",
    "CORE\TaskQueue.js",
    "CORE\Supervisor.js",
    "StartProductionSystem.js",
    "StartMilesProduction.js"
)

$syntaxResults = @()

foreach ($relativePath in $syntaxFiles) {
    $fullPath = Join-Path $MilesRoot $relativePath

    if (-not (Test-Path $fullPath)) {
        $syntaxResults += [pscustomobject]@{
            file = $relativePath
            status = "MISSING"
            message = "File not found"
        }
        continue
    }

    $output = & node --check $fullPath 2>&1
    $exitCode = $LASTEXITCODE

    $syntaxResults += [pscustomobject]@{
        file = $relativePath
        status = if ($exitCode -eq 0) { "PASS" } else { "FAIL" }
        message = ($output | Out-String).Trim()
    }

    if ($exitCode -ne 0) {
        throw "Syntax check failed for $relativePath`n$output"
    }

    Write-Host "PASS: $relativePath" -ForegroundColor Green
}

Write-Step "5. RECOVERING STALE RUNNING TASKS"

$queuePath = Join-Path $MilesRoot "DATA\runtime\task_queue.json"
$recoveredTasks = @()

if (Test-Path $queuePath) {
    $rawQueue = Get-Content $queuePath -Raw
    $tasks = @()

    if (-not [string]::IsNullOrWhiteSpace($rawQueue)) {
        $parsed = $rawQueue | ConvertFrom-Json
        if ($parsed -is [System.Array]) {
            $tasks = @($parsed)
        }
        elseif ($null -ne $parsed) {
            $tasks = @($parsed)
        }
    }

    $cutoff = (Get-Date).ToUniversalTime().AddMinutes(-1 * $StaleMinutes)

    foreach ($task in $tasks) {
        if ($task.status -ne "RUNNING") {
            continue
        }

        $timestampText = if ($task.updatedAt) { $task.updatedAt } else { $task.createdAt }
        $taskTime = $null

        try {
            $taskTime = [DateTime]::Parse($timestampText).ToUniversalTime()
        }
        catch {
            $taskTime = [DateTime]::MinValue
        }

        if ($taskTime -lt $cutoff) {
            $previousStatus = $task.status
            $task.status = "QUEUED"
            $task.updatedAt = (Get-Date).ToUniversalTime().ToString("o")
            $task.result = $null

            $task | Add-Member -Force -NotePropertyName recovery -NotePropertyValue ([pscustomobject]@{
                reason = "STALE_RUNNING_TASK"
                previousStatus = $previousStatus
                recoveredAt = (Get-Date).ToUniversalTime().ToString("o")
                recoveredBy = "Stabilize-MilesRuntime.ps1"
            })

            $recoveredTasks += [pscustomobject]@{
                id = $task.id
                type = $task.type
                previousStatus = $previousStatus
                newStatus = "QUEUED"
                previousUpdatedAt = $timestampText
            }
        }
    }

    if ($recoveredTasks.Count -gt 0) {
        Write-JsonAtomic -Data @($tasks) -Path $queuePath
        Write-Host "Recovered $($recoveredTasks.Count) stale RUNNING task(s)." -ForegroundColor Green
        $recoveredTasks | Format-Table -AutoSize
    }
    else {
        Write-Host "No stale RUNNING tasks required recovery." -ForegroundColor Yellow
    }
}
else {
    Write-Host "Task queue does not exist yet: $queuePath" -ForegroundColor Yellow
}

Write-Step "6. STARTING MILES PRODUCTION"

$startScript = Join-Path $MilesRoot "StartMilesProduction.js"
if (-not (Test-Path $startScript)) {
    throw "Missing production bootstrap: $startScript"
}

$process = Start-Process `
    -FilePath "node" `
    -ArgumentList @($startScript) `
    -WorkingDirectory $MilesRoot `
    -RedirectStandardOutput $stdoutPath `
    -RedirectStandardError $stderrPath `
    -PassThru

Write-Host "MILES production started. Supervisor PID: $($process.Id)" -ForegroundColor Green
Write-Host "Observing for $ObservationSeconds seconds..."

Start-Sleep -Seconds $ObservationSeconds

Write-Step "7. COLLECTING POST-START RUNTIME STATE"

$queueState = [ordered]@{
    total = 0
    queued = 0
    running = 0
    awaitingApproval = 0
    completed = 0
    failed = 0
}

$taskSnapshot = @()

if (Test-Path $queuePath) {
    $rawQueueAfter = Get-Content $queuePath -Raw

    if (-not [string]::IsNullOrWhiteSpace($rawQueueAfter)) {
        $parsedAfter = $rawQueueAfter | ConvertFrom-Json

        if ($parsedAfter -is [System.Array]) {
            $taskSnapshot = @($parsedAfter)
        }
        elseif ($null -ne $parsedAfter) {
            $taskSnapshot = @($parsedAfter)
        }
    }

    $queueState.total = $taskSnapshot.Count
    $queueState.queued = @($taskSnapshot | Where-Object status -eq "QUEUED").Count
    $queueState.running = @($taskSnapshot | Where-Object status -eq "RUNNING").Count
    $queueState.awaitingApproval = @($taskSnapshot | Where-Object status -eq "AWAITING_APPROVAL").Count
    $queueState.completed = @($taskSnapshot | Where-Object status -eq "COMPLETED").Count
    $queueState.failed = @($taskSnapshot | Where-Object status -eq "FAILED").Count
}

$latestRepositoryOutputs = @()

$repositoryOutputDir = Join-Path $MilesRoot "DATA\repository_search"
if (Test-Path $repositoryOutputDir) {
    $latestRepositoryOutputs = @(
        Get-ChildItem $repositoryOutputDir -Filter *.json -File |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 5 |
        ForEach-Object {
            [pscustomobject]@{
                name = $_.Name
                fullName = $_.FullName
                length = $_.Length
                lastWriteTime = $_.LastWriteTime.ToString("o")
            }
        }
    )
}

$stdoutTail = @()
$stderrTail = @()

if (Test-Path $stdoutPath) {
    $stdoutTail = @(Get-Content $stdoutPath -Tail 120)
}

if (Test-Path $stderrPath) {
    $stderrTail = @(Get-Content $stderrPath -Tail 80)
}

$targetRecoveredIds = @($recoveredTasks | ForEach-Object id)
$targetTaskResults = @(
    $taskSnapshot |
    Where-Object { $targetRecoveredIds -contains $_.id } |
    Select-Object id, type, status, provider, connector, action, updatedAt, result
)

$report = [ordered]@{
    generatedAt = (Get-Date).ToUniversalTime().ToString("o")
    milesRoot = $MilesRoot
    productionProcess = [ordered]@{
        supervisorPid = $process.Id
        running = -not $process.HasExited
        stdoutLog = $stdoutPath
        stderrLog = $stderrPath
    }
    backups = [ordered]@{
        directory = $backupDir
        files = $backedUpFiles
    }
    validation = [ordered]@{
        connector = $connectorChecks
        repositorySearch = $repositoryChecks
        syntax = $syntaxResults
    }
    recovery = [ordered]@{
        staleMinutes = $StaleMinutes
        tasksRecovered = $recoveredTasks
    }
    queue = $queueState
    recoveredTaskResults = $targetTaskResults
    latestRepositoryOutputs = $latestRepositoryOutputs
    stdoutTail = $stdoutTail
    stderrTail = $stderrTail
}

Write-JsonAtomic -Data $report -Path $reportPath

Write-Step "8. STABILIZATION RESULT"

Write-Host "Production running : $(-not $process.HasExited)"
Write-Host "Queued             : $($queueState.queued)"
Write-Host "Running            : $($queueState.running)"
Write-Host "Completed          : $($queueState.completed)"
Write-Host "Failed             : $($queueState.failed)"
Write-Host "Recovered tasks    : $($recoveredTasks.Count)"
Write-Host "Repository outputs : $($latestRepositoryOutputs.Count)"
Write-Host ""
Write-Host "Report: $reportPath" -ForegroundColor Cyan
Write-Host "Stdout: $stdoutPath" -ForegroundColor Cyan
Write-Host "Stderr: $stderrPath" -ForegroundColor Cyan

if ($targetTaskResults.Count -gt 0) {
    Write-Host ""
    Write-Host "Recovered task result(s):"
    $targetTaskResults | Format-List
}

Write-Host ""
Write-Host "MILES remains running under the production bootstrap." -ForegroundColor Green
