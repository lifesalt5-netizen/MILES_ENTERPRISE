param(
    [string]$Root = "C:\P2GC_Intelligence\MILES_ENTERPRISE",
    [switch]$ExecuteInstantlyWeekdayRepair
)

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path $Root).Path
$env:MILES_ROOT = $Root
Set-Location $Root

$outDir = Join-Path $Root 'DATA\operational_acceptance\pre_final_soak'
New-Item -ItemType Directory -Force $outDir | Out-Null
$outFile = Join-Path $outDir 'PRE_FINAL_SOAK_READINESS_LATEST.json'

$results = New-Object System.Collections.Generic.List[object]
$startedAt = (Get-Date).ToUniversalTime().ToString('o')
$head = (& git rev-parse HEAD).Trim()
$branch = (& git rev-parse --abbrev-ref HEAD).Trim()

function Add-Result {
    param([string]$Name,[string]$Status,[string]$Category,[int]$ExitCode,[string]$Detail,[bool]$Mutation=$false)
    $results.Add([pscustomobject]@{
        name=$Name; status=$Status; category=$Category; exitCode=$ExitCode; detail=$Detail; externalMutation=$Mutation
    }) | Out-Null
}

function Invoke-NodeCheck {
    param([string]$Name,[string]$Path,[string]$Category='STATIC')
    $full = Join-Path $Root $Path
    if(-not (Test-Path $full)) { Add-Result $Name 'YELLOW' $Category 0 "MISSING:$Path"; return }
    & node --check $full *> $null
    $ec = $LASTEXITCODE
    Add-Result $Name ($(if($ec -eq 0){'GREEN'}else{'RED'})) $Category $ec $Path
}

function Invoke-NodeRun {
    param([string]$Name,[string]$Path,[string[]]$Args=@(),[string]$Category='TEST',[bool]$Mutation=$false)
    $full = Join-Path $Root $Path
    if(-not (Test-Path $full)) { Add-Result $Name 'YELLOW' $Category 0 "MISSING:$Path" $Mutation; return }
    $output = & node $full @Args 2>&1 | Out-String
    $ec = $LASTEXITCODE
    $tail = if($output.Length -gt 3000){$output.Substring($output.Length-3000)}else{$output}
    Add-Result $Name ($(if($ec -eq 0){'GREEN'}else{'RED'})) $Category $ec $tail.Trim() $Mutation
}

function Invoke-PowerShellRun {
    param([string]$Name,[string]$Path,[string[]]$Args=@(),[string]$Category='LIVE_READONLY')
    $full = Join-Path $Root $Path
    if(-not (Test-Path $full)) { Add-Result $Name 'YELLOW' $Category 0 "MISSING:$Path"; return }
    $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $full @Args 2>&1 | Out-String
    $ec = $LASTEXITCODE
    $tail = if($output.Length -gt 3000){$output.Substring($output.Length-3000)}else{$output}
    Add-Result $Name ($(if($ec -eq 0){'GREEN'}else{'RED'})) $Category $ec $tail.Trim()
}

# 1) Syntax / contract checks for the release candidate.
$syntaxFiles = @(
    'SCRIPTS/AuditInstantlyCampaignScheduleGovernance.js',
    'SCRIPTS/AuditInstantlySendWindowHistory.js',
    'SCRIPTS/RepairInstantlyWeekdaySchedules.js',
    'SCRIPTS/AUDIT_MILES_REVENUE_OPERATIONS.js',
    'SERVICES/FederalPathwayScoreService.js',
    'SERVICES/FederalPathwayScoreIntegratedService.js',
    'SERVICES/revenue/RevenueWeightedCampaignScorecardService.js',
    'SERVICES/revenue/QualifiedProspectNurtureService.js',
    'SERVICES/revenue/P2GCAcquisitionV2CampaignService.js',
    'SERVICES/revenue/P2GCAcquisitionV2ProspectEnrichmentService.js',
    'SERVICES/revenue/P2GCWebsiteConversionAuditService.js',
    'CONNECTORS/WEBSITE_B12/B12_CONTROLLED_PUBLISHER.js',
    'RUN_FEDERAL_PATHWAY_SCORE_INTEGRATED.js',
    'RUN_P2GC_REVENUE_SCORECARD.js',
    'RUN_P2GC_QUALIFIED_NURTURE.js',
    'RUN_P2GC_ACQUISITION_V2_PILOT.js',
    'SCRIPTS/AuditProposalCommandReadiness.js'
)
foreach($f in $syntaxFiles){ Invoke-NodeCheck "syntax:$f" $f 'STATIC' }

# 2) Unit / safety / regression tests. These must not perform external mutations.
$tests = @(
    'TESTS/Test_InstantlyCampaignScheduleGovernance.js',
    'TESTS/Test_InstantlySendWindowHistory.js',
    'TESTS/Test_FederalPathwayScoreService.js',
    'TESTS/Test_FederalPathwayScoreIntegratedService.js',
    'TESTS/Test_RevenueWeightedCampaignScorecardService.js',
    'TESTS/Test_QualifiedProspectNurtureService.js',
    'TESTS/Test_P2GCAcquisitionV2CampaignService.js',
    'TESTS/Test_P2GCAcquisitionV2ProspectEnrichmentService.js',
    'TESTS/Test_P2GCB12ConversionManifest.js',
    'TESTS/Test_P2GCWebsiteConversionAuditService.js',
    'TESTS/E0030RevenueTruthGate.test.js',
    'TESTS/meeting_pipeline_readonly_safety_test.js',
    'TESTS/production_go_live_acceptance_audit_safety_test.js',
    'TESTS/TestExecutiveDashboardData.js',
    'TESTS/TestExecutiveMissionRouter.js',
    'TESTS/TestExecutiveToEngineering.js',
    'TESTS/TestExecutiveToEngineeringFlow.js'
)
foreach($t in $tests){ Invoke-NodeRun "test:$t" $t @() 'TEST' $false }

# 3) Known Instantly weekday defect: plan first. Mutation is explicit and read-back verified by the repair utility.
Invoke-NodeRun 'instantly_weekday_repair_plan' 'SCRIPTS/RepairInstantlyWeekdaySchedules.js' @("--root=$Root") 'LIVE_READONLY' $false
if($ExecuteInstantlyWeekdayRepair){
    $oldDry = $env:MILES_DRY_RUN
    $oldAllow = $env:MILES_ALLOW_INSTANTLY_MUTATIONS
    try {
        $env:MILES_DRY_RUN='false'
        $env:MILES_ALLOW_INSTANTLY_MUTATIONS='true'
        Invoke-NodeRun 'instantly_weekday_repair_execute' 'SCRIPTS/RepairInstantlyWeekdaySchedules.js' @("--root=$Root",'--execute') 'CONTROLLED_MUTATION' $true
    } finally {
        $env:MILES_DRY_RUN=$oldDry
        $env:MILES_ALLOW_INSTANTLY_MUTATIONS=$oldAllow
    }
    Invoke-NodeRun 'instantly_weekday_repair_readback_plan' 'SCRIPTS/RepairInstantlyWeekdaySchedules.js' @("--root=$Root") 'LIVE_READONLY' $false
}

# 4) Current live/read-only production truth gates.
Invoke-PowerShellRun 'production_acceptance' 'SCRIPTS/AUDIT_MILES_PRODUCTION_ACCEPTANCE.ps1' @('-Root',$Root) 'LIVE_READONLY'
Invoke-NodeRun 'revenue_operations' 'SCRIPTS/AUDIT_MILES_REVENUE_OPERATIONS.js' @($Root) 'LIVE_READONLY' $false
Invoke-NodeRun 'primary_inbox_coverage' 'SCRIPTS/AuditPrimaryInboxCoverage.js' @() 'LIVE_READONLY' $false
Invoke-NodeRun 'instantly_campaign_schedule_governance' 'SCRIPTS/AuditInstantlyCampaignScheduleGovernance.js' @() 'LIVE_READONLY' $false
Invoke-NodeRun 'instantly_send_window_last24h' 'SCRIPTS/AuditInstantlySendWindowHistory.js' @("--root=$Root") 'LIVE_READONLY' $false

# 5) Acquisition V2 readiness. Explicitly force no campaign creation/activation.
$oldExec = $env:P2GC_ACQ_V2_EXECUTE
$oldActivate = $env:P2GC_ACQ_V2_ACTIVATE
try {
    $env:P2GC_ACQ_V2_EXECUTE='false'
    $env:P2GC_ACQ_V2_ACTIVATE='false'
    Invoke-NodeRun 'federal_pathway_score_integrated' 'RUN_FEDERAL_PATHWAY_SCORE_INTEGRATED.js' @() 'READINESS' $false
    Invoke-NodeRun 'revenue_weighted_campaign_scorecard' 'RUN_P2GC_REVENUE_SCORECARD.js' @() 'READINESS' $false
    Invoke-NodeRun 'qualified_prospect_nurture' 'RUN_P2GC_QUALIFIED_NURTURE.js' @() 'READINESS' $false
    Invoke-NodeRun 'acquisition_v2_pilot_no_mutation' 'RUN_P2GC_ACQUISITION_V2_PILOT.js' @() 'READINESS' $false
} finally {
    $env:P2GC_ACQ_V2_EXECUTE=$oldExec
    $env:P2GC_ACQ_V2_ACTIVATE=$oldActivate
}

# 6) Proposal Command static/callability inventory. This does not claim production acceptance.
Invoke-NodeRun 'proposal_command_readiness_inventory' 'SCRIPTS/AuditProposalCommandReadiness.js' @("--root=$Root") 'READINESS' $false

$red = @($results | Where-Object {$_.status -eq 'RED'}).Count
$yellow = @($results | Where-Object {$_.status -eq 'YELLOW'}).Count
$green = @($results | Where-Object {$_.status -eq 'GREEN'}).Count
$mutations = @($results | Where-Object {$_.externalMutation -eq $true}).Count

$result = [ordered]@{
    ok = ($red -eq 0)
    status = if($red -eq 0){'PRE_FINAL_SOAK_READINESS_GREEN'}else{'PRE_FINAL_SOAK_READINESS_BLOCKED'}
    generatedAt = (Get-Date).ToUniversalTime().ToString('o')
    startedAt = $startedAt
    gitHead = $head
    gitBranch = $branch
    executeInstantlyWeekdayRepairRequested = [bool]$ExecuteInstantlyWeekdayRepair
    counts = @{ green=$green; yellow=$yellow; red=$red; controlledMutations=$mutations; total=$results.Count }
    rules = @(
        'No acquisition campaign creation/activation during readiness.',
        'No B12 public publish during readiness.',
        'Instantly weekday repair is the only allowed external mutation and only with the explicit switch.',
        'Final 24-hour soak must begin only after all RED blockers are resolved and one release-candidate commit is frozen.'
    )
    results = @($results)
}
$result | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $outFile -Encoding UTF8
Write-Host ""
Write-Host "PRE-FINAL-SOAK READINESS: $($result.status)"
Write-Host "GREEN=$green YELLOW=$yellow RED=$red CONTROLLED_MUTATIONS=$mutations"
Write-Host "REPORT=$outFile"
if($red -gt 0){ exit 2 }
