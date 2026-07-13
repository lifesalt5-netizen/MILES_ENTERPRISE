# COLLECT_MILES_BUILD_019_AUTONOMOUS_OPERATIONS_SOURCE.ps1
# Read-only source collector for Build 019.
# Does not modify MILES.
#
# Goal:
# Identify the authoritative existing Autonomous COO / operations loop,
# startup wiring, objective generation, scheduling, queue dispatch,
# governance, provider health, and verification services before replacement.

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Root = "D:\P2GC_Intelligence\MILES_ENTERPRISE"

if (-not (Test-Path $Root)) {
    throw "Authoritative MILES root not found: $Root"
}

Set-Location $Root

$Output = Join-Path $Root "MILES_BUILD_019_AUTONOMOUS_OPERATIONS_SOURCE.txt"
Remove-Item $Output -Force -ErrorAction SilentlyContinue

function Add-Header {
    param([string]$Text)

    Add-Content $Output ""
    Add-Content $Output "============================================================"
    Add-Content $Output $Text
    Add-Content $Output "============================================================"
}

function Add-File {
    param([string]$RelativePath)

    Add-Header "FILE: $RelativePath"

    $FullPath = Join-Path $Root $RelativePath

    if (Test-Path $FullPath) {
        Get-Content $FullPath | Add-Content $Output
    }
    else {
        Add-Content $Output "FILE NOT FOUND"
    }
}

$ExactFiles = @(
    ".\StartMilesProduction.js",
    ".\StartProductionSystem.js",
    ".\StartAutonomousCOO.js",
    ".\StartMiles.js",

    ".\SERVICES\AutonomousCOO.js",
    ".\SERVICES\AutonomousCOOService.js",
    ".\SERVICES\AutonomousOperationsEngine.js",
    ".\SERVICES\digital_coo\AutonomousCOO.js",
    ".\SERVICES\digital_coo\MilesCommandCenter.js",

    ".\SERVICES\ExecutiveBrainService.js",
    ".\SERVICES\ExecutiveStateService.js",
    ".\SERVICES\PlannerService.js",
    ".\SERVICES\CapabilityService.js",
    ".\SERVICES\WorkflowService.js",
    ".\SERVICES\WorkPackageService.js",
    ".\SERVICES\ExecutionService.js",
    ".\SERVICES\WorkforceExecutionService.js",
    ".\SERVICES\ExecutionPlanService.js",

    ".\SERVICES\TaskManager.js",
    ".\CORE\TaskQueue.js",
    ".\SERVICES\QueueService.js",

    ".\SERVICES\SchedulerService.js",
    ".\SERVICES\CronService.js",
    ".\SERVICES\OperationalSchedulerService.js",
    ".\SERVICES\ContinuousExecutionService.js",
    ".\SERVICES\ExecutionLoopService.js",

    ".\SERVICES\Decision\DecisionEngine.js",
    ".\SERVICES\GovernanceService.js",
    ".\SERVICES\ApprovalService.js",

    ".\SERVICES\ProviderRouterService.js",
    ".\SERVICES\ProviderAuthorityRegistryService.js",
    ".\SERVICES\ProviderCapabilityBindingService.js",
    ".\SERVICES\ProviderSynchronizationService.js",

    ".\SERVICES\HealthService.js",
    ".\SERVICES\SystemHealthService.js",
    ".\SERVICES\ProviderControllerHealthService.js",

    ".\CONFIG\WORKFLOWS\planning_rules.json",
    ".\CONFIG\governance.json",
    ".\CONFIG\GOALS\CEO_GOALS.json",
    ".\DATA\executive_state.json",
    ".\DATA\business_inputs\business_input_registry.json",
    ".\DATA\runtime\capability_registry.json",
    ".\DATA\runtime\worker_registry.json"
)

foreach ($File in $ExactFiles) {
    Add-File $File
}

Add-Header "AUTONOMOUS / COO / OPERATIONS SERVICE INVENTORY"

Get-ChildItem ".\SERVICES", ".\CORE", "." -Recurse -File -Include *.js |
    Where-Object {
        $_.FullName -notmatch "\\node_modules\\" -and
        $_.Name -match "Autonomous|COO|Operations|Orchestrator|Scheduler|Loop|Objective|ExecutiveBrain|Health|Supervisor"
    } |
    Select-Object FullName, Length, LastWriteTime |
    Sort-Object FullName |
    Format-Table -Wrap -AutoSize |
    Out-String |
    Add-Content $Output

Add-Header "STARTUP WIRING REFERENCES"

$StartupPatterns = @(
    "StartAutonomousCOO",
    "AutonomousCOO",
    "createWorkflow",
    "runNext",
    "runAll",
    "setInterval",
    "setTimeout",
    "schedule",
    "cron",
    "TaskQueue",
    "ExecutionService",
    "ExecutiveBrain",
    "generateObjective",
    "createObjective"
)

foreach ($Pattern in $StartupPatterns) {
    Add-Content $Output ""
    Add-Content $Output "### REFERENCES: $Pattern"

    Get-ChildItem ".", ".\SERVICES", ".\CORE" -Recurse -File -Include *.js |
        Where-Object {
            $_.FullName -notmatch "\\node_modules\\"
        } |
        Select-String -Pattern $Pattern |
        Select-Object Path, LineNumber, Line |
        Format-Table -Wrap -AutoSize |
        Out-String |
        Add-Content $Output
}

Add-Header "QUEUE / WORK PACKAGE / EXECUTION STATE INVENTORY"

$StateFolders = @(
    ".\DATA\work_packages",
    ".\DATA\workforce_results",
    ".\DATA\execution",
    ".\DATA\executive",
    ".\DATA\approvals",
    ".\DATA\runtime"
)

foreach ($Folder in $StateFolders) {
    Add-Content $Output ""
    Add-Content $Output "### FOLDER: $Folder"

    if (Test-Path $Folder) {
        Get-ChildItem $Folder -File -Recurse |
            Select-Object -First 50 FullName, Length, LastWriteTime |
            Format-Table -Wrap -AutoSize |
            Out-String |
            Add-Content $Output
    }
    else {
        Add-Content $Output "FOLDER NOT FOUND"
    }
}

Add-Header "PACKAGE.JSON SCRIPTS"

if (Test-Path ".\package.json") {
    Get-Content ".\package.json" | Add-Content $Output
}
else {
    Add-Content $Output "package.json NOT FOUND"
}

Add-Header "CURRENT NODE PROCESS SNAPSHOT"

Get-CimInstance Win32_Process |
    Where-Object {
        $_.Name -eq "node.exe"
    } |
    Select-Object ProcessId, CommandLine |
    Format-Table -Wrap -AutoSize |
    Out-String |
    Add-Content $Output

Add-Header "COLLECTION SUMMARY"

$Summary = [ordered]@{
    collectedAt = (Get-Date).ToString("o")
    root = $Root
    output = $Output
    length = (Get-Item $Output).Length
    readOnly = $true
    mission = "Identify and extend the authoritative Autonomous COO operations loop without creating duplicate services."
}

$Summary |
    ConvertTo-Json -Depth 6 |
    Add-Content $Output

Get-Item $Output | Select-Object FullName, Length, LastWriteTime

Write-Host ""
Write-Host "Upload this exact file:"
Write-Host $Output
