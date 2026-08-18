param(
    [string]$RepoRoot = "C:\P2GC_Intelligence\MILES_ENTERPRISE"
)

$ErrorActionPreference = "Stop"

function Write-Section([string]$Text) {
    Write-Host ""
    Write-Host "============================================================"
    Write-Host $Text
    Write-Host "============================================================"
}

if (-not (Test-Path $RepoRoot)) {
    throw "MILES repository not found: $RepoRoot"
}

Write-Section "P2GC SAFE REVENUE AUDIT"
Write-Host "Production checkout will NOT be merged, rebased, reset, or modified."
Write-Host "Instantly mutations will be forced OFF for this run."

Set-Location $RepoRoot

git fetch origin main
if ($LASTEXITCODE -ne 0) {
    throw "git fetch origin main failed."
}

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$worktree = "C:\P2GC_Intelligence\MILES_REVENUE_AUDIT_$stamp"

Write-Section "CREATE DETACHED WORKTREE"
git worktree add --detach $worktree origin/main
if ($LASTEXITCODE -ne 0) {
    throw "Unable to create detached revenue-audit worktree."
}

if (Test-Path (Join-Path $RepoRoot ".env")) {
    Copy-Item (Join-Path $RepoRoot ".env") (Join-Path $worktree ".env") -Force
    Write-Host "Copied local .env into detached worktree without displaying secrets."
} else {
    Write-Warning "No .env found in $RepoRoot. Instantly live READS may report INSTANTLY_API_KEY not configured."
}

$nodeModules = Join-Path $RepoRoot "node_modules"
if (Test-Path $nodeModules) {
    $env:NODE_PATH = $nodeModules
    Write-Host "Using production node_modules through NODE_PATH."
} else {
    Write-Warning "node_modules was not found at $nodeModules."
}

# Hard safety gates for the entire audit process.
$env:MILES_ROOT = $worktree
$env:MILES_DRY_RUN = "true"
$env:MILES_ALLOW_INSTANTLY_MUTATIONS = "false"
$env:MILES_AUTONOMOUS_EXECUTE = "false"
$env:CAPTURE_CAPACITY_AUTO_STAGE = "false"

Set-Location $worktree

Write-Host ""
Write-Host "Worktree: $worktree"
Write-Host "Commit: $(git rev-parse --short HEAD)"

$results = @()

function Invoke-RevenueStep {
    param(
        [string]$Name,
        [string]$Script
    )

    Write-Section $Name
    $logName = ($Name -replace '[^A-Za-z0-9_-]', '_') + ".log"
    $logPath = Join-Path $worktree $logName

    & node $Script 2>&1 | Tee-Object -FilePath $logPath
    $exitCode = $LASTEXITCODE

    $script:results += [pscustomobject]@{
        Step = $Name
        Script = $Script
        ExitCode = $exitCode
        Log = $logPath
    }

    if ($exitCode -ne 0) {
        Write-Warning "$Name exited with code $exitCode. Continuing so all revenue lanes are audited."
    }
}

# Reply Intelligence runs first so its hard suppression master is available
# to Win-Back and Capture Capacity planning in this same worktree.
Invoke-RevenueStep -Name "1 LIVE INSTANTLY REPLY INTELLIGENCE" -Script ".\RUN_P2GC_REPLY_INTELLIGENCE.js"
Invoke-RevenueStep -Name "2 WINBACK RECOVERY AND CAMPAIGN PLAN" -Script ".\RUN_P2GC_WINBACK_CAMPAIGN.js"
Invoke-RevenueStep -Name "3 CAPTURE CAPACITY PROSPECT DISCOVERY" -Script ".\RUN_CAPTURE_CAPACITY_PROSPECT_DISCOVERY.js"
Invoke-RevenueStep -Name "4 CAPTURE CAPACITY CAMPAIGN PLAN" -Script ".\RUN_CAPTURE_CAPACITY_CAMPAIGN.js"
Invoke-RevenueStep -Name "5 CONSOLIDATED CURRENT PHASE STATUS" -Script ".\RUN_P2GC_CURRENT_PHASE_STATUS.js"

Write-Section "AUDIT SUMMARY"
$results | Format-Table -AutoSize

Write-Host ""
Write-Host "Primary output locations:"
Write-Host "  Current phase status:  $worktree\DATA\runtime\revenue\current_phase\current_phase_revenue_status_latest.json"
Write-Host "  Win-Back master:       $worktree\DATA\runtime\revenue\winback\WINBACK_MASTER_LATEST.csv"
Write-Host "  Win-Back prior ready:  $worktree\DATA\runtime\revenue\winback\WINBACK_READY_PRIOR_CONVERSATIONS.csv"
Write-Host "  Win-Back reactivation: $worktree\DATA\runtime\revenue\winback\WINBACK_READY_REACTIVATION.csv"
Write-Host "  Win-Back review queue: $worktree\DATA\runtime\revenue\winback\WINBACK_REVIEW_QUEUE.csv"
Write-Host "  Reply intelligence:    $worktree\DATA\runtime\revenue\replies\reply_intelligence_latest.json"
Write-Host "  Reply KPI:             $worktree\DATA\runtime\revenue\replies\reply_kpis_latest.json"
Write-Host "  Qualified replies:     $worktree\DATA\runtime\revenue\replies\qualified_reply_queue.json"
Write-Host "  Follow-up queue:       $worktree\DATA\runtime\revenue\replies\followup_queue.json"
Write-Host "  Suppression master:    $worktree\DATA\runtime\revenue\replies\global_suppression_master.json"
Write-Host ""
Write-Host "SAFETY: no --apply, no --activate, MILES_DRY_RUN=true, Instantly mutations disabled."
Write-Host "Worktree retained for review: $worktree"

$failed = @($results | Where-Object { $_.ExitCode -ne 0 })
if ($failed.Count -gt 0) {
    Write-Warning "$($failed.Count) audit step(s) reported a non-zero exit code. Review the consolidated status and step logs above."
    exit 2
}

Write-Host "All five revenue audit/status steps completed successfully."
exit 0
