<#
MILES OS — Digital COO Autonomy Supervisor
Production replacement file.

Purpose:
Coordinates the autonomous Digital COO runtime by verifying core runtime
components, monitoring health, supervising lifecycle state, feeding executive
intelligence, feeding learning, and preparing recovery instructions.

No external dependencies.
#>

param(
    [string]$MilesRoot = "D:\P2GC_Intelligence\MILES_OS",
    [switch]$Once
)

$ErrorActionPreference = "Stop"

$Now = Get-Date
$RuntimeDir = Join-Path $MilesRoot "runtime"
$StateDir = Join-Path $MilesRoot "state"
$LogsDir = Join-Path $MilesRoot "logs"
$HealthDir = Join-Path $MilesRoot "health"
$ExecIntelDir = Join-Path $MilesRoot "executive_intelligence"
$LearningDir = Join-Path $MilesRoot "learning"
$RecoveryDir = Join-Path $MilesRoot "recovery"

$SupervisorStateFile = Join-Path $StateDir "digital_coo_autonomy_supervisor_state.json"
$HealthFile = Join-Path $HealthDir "digital_coo_autonomy_supervisor_health.json"
$ExecIntelFeedFile = Join-Path $ExecIntelDir "digital_coo_autonomy_feed.json"
$LearningFeedFile = Join-Path $LearningDir "digital_coo_learning_feed.json"
$RecoveryPlanFile = Join-Path $RecoveryDir "digital_coo_recovery_plan.json"
$LogFile = Join-Path $LogsDir "digital_coo_autonomy_supervisor.log"

$RequiredDirectories = @(
    $RuntimeDir,
    $StateDir,
    $LogsDir,
    $HealthDir,
    $ExecIntelDir,
    $LearningDir,
    $RecoveryDir
)

foreach ($dir in $RequiredDirectories) {
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
}

function Write-MilesLog {
    param(
        [string]$Level,
        [string]$Message
    )

    $entry = @{
        timestamp = (Get-Date).ToString("o")
        level     = $Level
        message   = $Message
    } | ConvertTo-Json -Compress

    Add-Content -Path $LogFile -Value $entry
}

function Save-Json {
    param(
        [string]$Path,
        [object]$Data
    )

    $Data | ConvertTo-Json -Depth 20 | Set-Content -Path $Path -Encoding UTF8
}

function Read-JsonSafe {
    param(
        [string]$Path,
        [object]$Default
    )

    if (-not (Test-Path $Path)) {
        return $Default
    }

    try {
        return Get-Content -Path $Path -Raw | ConvertFrom-Json
    }
    catch {
        Write-MilesLog -Level "WARN" -Message "Failed to read JSON file: $Path. Using default."
        return $Default
    }
}

function Find-MilesFile {
    param(
        [string[]]$Names
    )

    foreach ($name in $Names) {
        $direct = Join-Path $MilesRoot $name
        if (Test-Path $direct) {
            return $direct
        }

        $found = Get-ChildItem -Path $MilesRoot -Recurse -File -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -ieq $name } |
            Select-Object -First 1

        if ($found) {
            return $found.FullName
        }
    }

    return $null
}

function Test-ComponentPresence {
    param(
        [string]$ComponentName,
        [string[]]$CandidateFiles,
        [string[]]$ExpectedMarkers
    )

    $file = Find-MilesFile -Names $CandidateFiles

    $result = [ordered]@{
        component       = $ComponentName
        present         = $false
        file            = $null
        markers_checked = $ExpectedMarkers
        markers_found   = @()
        status          = "missing"
        risk            = "high"
    }

    if (-not $file) {
        return $result
    }

    $content = ""
    try {
        $content = Get-Content -Path $file -Raw -ErrorAction Stop
    }
    catch {
        $result.file = $file
        $result.status = "unreadable"
        $result.risk = "high"
        return $result
    }

    $foundMarkers = @()

    foreach ($marker in $ExpectedMarkers) {
        if ($content -match [regex]::Escape($marker)) {
            $foundMarkers += $marker
        }
    }

    $result.present = $true
    $result.file = $file
    $result.markers_found = $foundMarkers

    if ($ExpectedMarkers.Count -eq 0 -or $foundMarkers.Count -gt 0) {
        $result.status = "available"
        $result.risk = "low"
    }
    else {
        $result.status = "present_marker_unverified"
        $result.risk = "medium"
    }

    return $result
}

function Get-RuntimeAudit {
    $components = @(
        @{
            name = "WorkerRegistry"
            files = @("worker_registry.ps1", "worker_registry.py", "WorkerRegistry.ps1", "WorkerRegistry.py")
            markers = @("WorkerRegistry", "register", "worker")
        },
        @{
            name = "WorkerDispatcher"
            files = @("worker_dispatcher.ps1", "worker_dispatcher.py", "WorkerDispatcher.ps1", "WorkerDispatcher.py")
            markers = @("WorkerDispatcher", "dispatch", "worker")
        },
        @{
            name = "WorkerRuntime"
            files = @("worker_runtime.ps1", "worker_runtime.py", "WorkerRuntime.ps1", "WorkerRuntime.py")
            markers = @("WorkerRuntime", "run", "worker")
        },
        @{
            name = "WorkerRuntimeManager"
            files = @("worker_runtime_manager.ps1", "worker_runtime_manager.py", "WorkerRuntimeManager.ps1", "WorkerRuntimeManager.py")
            markers = @("WorkerRuntimeManager", "manage", "runtime")
        },
        @{
            name = "ConnectorRuntime"
            files = @("connector_runtime.ps1", "connector_runtime.py", "ConnectorRuntime.ps1", "ConnectorRuntime.py")
            markers = @("ConnectorRuntime", "connector")
        },
        @{
            name = "ConnectorRuntimeManager"
            files = @("connector_runtime_manager.ps1", "connector_runtime_manager.py", "ConnectorRuntimeManager.ps1", "ConnectorRuntimeManager.py")
            markers = @("ConnectorRuntimeManager", "connector", "runtime")
        },
        @{
            name = "AutonomousWorkOrchestrator"
            files = @("autonomous_work_orchestrator.ps1", "autonomous_work_orchestrator.py", "AutonomousWorkOrchestrator.ps1", "AutonomousWorkOrchestrator.py")
            markers = @("AutonomousWorkOrchestrator", "orchestrator")
        },
        @{
            name = "AutonomousWorkOrchestratorManager"
            files = @("autonomous_work_orchestrator_manager.ps1", "autonomous_work_orchestrator_manager.py", "AutonomousWorkOrchestratorManager.ps1", "AutonomousWorkOrchestratorManager.py")
            markers = @("AutonomousWorkOrchestratorManager", "orchestrator", "manager")
        },
        @{
            name = "DigitalCOORuntime"
            files = @("digital_coo_runtime.ps1", "digital_coo_runtime.py", "DigitalCOORuntime.ps1", "DigitalCOORuntime.py")
            markers = @("DigitalCOORuntime", "Digital COO")
        },
        @{
            name = "DigitalCOORuntimeManager"
            files = @("digital_coo_runtime_manager.ps1", "digital_coo_runtime_manager.py", "DigitalCOORuntimeManager.ps1", "DigitalCOORuntimeManager.py")
            markers = @("DigitalCOORuntimeManager", "Digital COO", "manager")
        },
        @{
            name = "DigitalCOOHost"
            files = @("digital_coo_host.ps1", "digital_coo_host.py", "DigitalCOOHost.ps1", "DigitalCOOHost.py")
            markers = @("DigitalCOOHost", "host")
        }
    )

    $results = @()

    foreach ($component in $components) {
        $results += Test-ComponentPresence `
            -ComponentName $component.name `
            -CandidateFiles $component.files `
            -ExpectedMarkers $component.markers
    }

    return $results
}

function Get-HealthSummary {
    param(
        [object[]]$Audit
    )

    $missing = @($Audit | Where-Object { $_.status -eq "missing" })
    $unreadable = @($Audit | Where-Object { $_.status -eq "unreadable" })
    $mediumRisk = @($Audit | Where-Object { $_.risk -eq "medium" })
    $highRisk = @($Audit | Where-Object { $_.risk -eq "high" })

    $status = "healthy"

    if ($highRisk.Count -gt 0) {
        $status = "degraded"
    }

    if ($missing.Count -ge 3 -or $unreadable.Count -gt 0) {
        $status = "critical"
    }

    return [ordered]@{
        status               = $status
        components_checked   = $Audit.Count
        missing_components   = $missing.component
        unreadable_components = $unreadable.component
        medium_risk          = $mediumRisk.component
        high_risk            = $highRisk.component
    }
}

function Build-RecoveryPlan {
    param(
        [object[]]$Audit,
        [object]$HealthSummary
    )

    $actions = @()

    foreach ($item in $Audit) {
        if ($item.status -eq "missing") {
            $actions += [ordered]@{
                component = $item.component
                action    = "verify_file_exists_in_production_repository"
                severity  = "high"
                notes     = "Required runtime integration component not discoverable under production repository."
            }
        }
        elseif ($item.status -eq "unreadable") {
            $actions += [ordered]@{
                component = $item.component
                action    = "restore_or_fix_file_permissions"
                severity  = "high"
                notes     = "Component file exists but could not be read."
            }
        }
        elseif ($item.status -eq "present_marker_unverified") {
            $actions += [ordered]@{
                component = $item.component
                action    = "verify_current_interface_contract"
                severity  = "medium"
                notes     = "Component exists, but expected integration markers were not confirmed."
            }
        }
    }

    if ($actions.Count -eq 0) {
        $actions += [ordered]@{
            component = "DigitalCOOAutonomySupervisor"
            action    = "continue_autonomous_supervision"
            severity  = "low"
            notes     = "Runtime audit passed."
        }
    }

    return [ordered]@{
        generated_at = (Get-Date).ToString("o")
        status       = $HealthSummary.status
        actions      = $actions
    }
}

function Build-ExecutiveFeed {
    param(
        [object]$HealthSummary,
        [object[]]$Audit
    )

    return [ordered]@{
        generated_at = (Get-Date).ToString("o")
        source       = "Digital COO Autonomy Supervisor"
        summary      = [ordered]@{
            runtime_status       = $HealthSummary.status
            components_checked   = $HealthSummary.components_checked
            missing_components   = $HealthSummary.missing_components
            medium_risk          = $HealthSummary.medium_risk
            high_risk            = $HealthSummary.high_risk
        }
        operational_signal = if ($HealthSummary.status -eq "healthy") {
            "Digital COO runtime chain is available for continued autonomous operation."
        }
        elseif ($HealthSummary.status -eq "degraded") {
            "Digital COO runtime is partially degraded. Recovery plan generated."
        }
        else {
            "Digital COO runtime requires immediate repair before reliable autonomy."
        }
        component_audit = $Audit
    }
}

function Build-LearningFeed {
    param(
        [object]$HealthSummary,
        [object[]]$Audit
    )

    $lessons = @()

    foreach ($item in $Audit) {
        $lessons += [ordered]@{
            timestamp = (Get-Date).ToString("o")
            subject   = $item.component
            signal    = $item.status
            risk      = $item.risk
            lesson    = "Runtime supervision should verify active implementation files dynamically before assuming interface availability."
        }
    }

    return [ordered]@{
        generated_at = (Get-Date).ToString("o")
        source       = "Digital COO Autonomy Supervisor"
        health       = $HealthSummary.status
        lessons      = $lessons
    }
}

function Invoke-DigitalCOOAutonomySupervisor {
    Write-MilesLog -Level "INFO" -Message "Digital COO autonomy supervisor cycle started."

    $previousState = Read-JsonSafe -Path $SupervisorStateFile -Default ([ordered]@{
        cycle_count = 0
        last_status = "unknown"
    })

    $cycleCount = 0
    if ($previousState.cycle_count -ne $null) {
        $cycleCount = [int]$previousState.cycle_count
    }

    $audit = @(Get-RuntimeAudit)
    $healthSummary = Get-HealthSummary -Audit $audit
    $recoveryPlan = Build-RecoveryPlan -Audit $audit -HealthSummary $healthSummary
    $executiveFeed = Build-ExecutiveFeed -HealthSummary $healthSummary -Audit $audit
    $learningFeed = Build-LearningFeed -HealthSummary $healthSummary -Audit $audit

    $state = [ordered]@{
        supervisor              = "Digital COO Autonomy Supervisor"
        version                 = "1.0.0"
        production_repository   = $MilesRoot
        generated_at            = (Get-Date).ToString("o")
        cycle_count             = ($cycleCount + 1)
        current_status          = $healthSummary.status
        previous_status         = $previousState.last_status
        runtime_chain_verified  = ($healthSummary.status -eq "healthy")
        health_file             = $HealthFile
        executive_feed_file     = $ExecIntelFeedFile
        learning_feed_file      = $LearningFeedFile
        recovery_plan_file      = $RecoveryPlanFile
    }

    Save-Json -Path $HealthFile -Data ([ordered]@{
        generated_at = (Get-Date).ToString("o")
        supervisor   = "Digital COO Autonomy Supervisor"
        health       = $healthSummary
        audit        = $audit
    })

    Save-Json -Path $RecoveryPlanFile -Data $recoveryPlan
    Save-Json -Path $ExecIntelFeedFile -Data $executiveFeed
    Save-Json -Path $LearningFeedFile -Data $learningFeed
    Save-Json -Path $SupervisorStateFile -Data $state

    Write-MilesLog -Level "INFO" -Message "Digital COO autonomy supervisor cycle completed with status: $($healthSummary.status)."

    return $state
}

try {
    do {
        $result = Invoke-DigitalCOOAutonomySupervisor

        if ($Once) {
            break
        }

        Start-Sleep -Seconds 60
    }
    while ($true)
}
catch {
    Write-MilesLog -Level "ERROR" -Message $_.Exception.Message

    $failure = [ordered]@{
        generated_at = (Get-Date).ToString("o")
        supervisor   = "Digital COO Autonomy Supervisor"
        status       = "failed"
        error        = $_.Exception.Message
    }

    Save-Json -Path $HealthFile -Data $failure
    throw
}