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
$originMain = ''
$script:LocalOperationalConfigBaseline = $null

function Add-Result { param([string]$Name,[string]$Status,[string]$Category,[int]$ExitCode,[string]$Detail,[bool]$Mutation=$false); $results.Add([pscustomobject]@{name=$Name;status=$Status;category=$Category;exitCode=$ExitCode;detail=$Detail;externalMutation=$Mutation}) | Out-Null }
function Read-JsonSafe { param([string]$Path); if(-not(Test-Path -LiteralPath $Path -PathType Leaf)){return $null}; try{Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json}catch{return $null} }
function Invoke-NodeCheck {
    param([string]$Name,[string]$Path,[string]$Category='STATIC')
    $full=Join-Path $Root $Path; if(-not(Test-Path $full)){Add-Result $Name 'YELLOW' $Category 0 "MISSING:$Path";return}
    & node --check $full *> $null; $ec=$LASTEXITCODE; Add-Result $Name ($(if($ec -eq 0){'GREEN'}else{'RED'})) $Category $ec $Path
}
function Invoke-NodeRun {
    param([string]$Name,[string]$Path,[string[]]$Arguments=@(),[string]$Category='TEST',[bool]$Mutation=$false,[switch]$Advisory)
    $full=Join-Path $Root $Path; if(-not(Test-Path $full)){Add-Result $Name 'YELLOW' $Category 0 "MISSING:$Path" $Mutation;return}
    $output=& node $full @Arguments 2>&1 | Out-String; $ec=$LASTEXITCODE; $tail=if($output.Length -gt 3000){$output.Substring($output.Length-3000)}else{$output}
    $status=if($ec -eq 0){'GREEN'}elseif($Advisory){'YELLOW'}else{'RED'}; Add-Result $Name $status $Category $ec $tail.Trim() $Mutation
}
function Invoke-PowerShellRun {
    param([string]$Name,[string]$Path,[string[]]$Arguments=@(),[string]$Category='LIVE_READONLY',[switch]$Advisory)
    $full=Join-Path $Root $Path; if(-not(Test-Path $full)){Add-Result $Name 'YELLOW' $Category 0 "MISSING:$Path";return}
    $output=& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $full @Arguments 2>&1 | Out-String; $ec=$LASTEXITCODE; $tail=if($output.Length -gt 3000){$output.Substring($output.Length-3000)}else{$output}
    $status=if($ec -eq 0){'GREEN'}elseif($Advisory){'YELLOW'}else{'RED'}; Add-Result $Name $status $Category $ec $tail.Trim()
}
function Test-SourceDrift {
    param([string]$Name)
    $sourcePaths=@('API','CORE','SERVICES','SCRIPTS','CONNECTORS','WORKERS','TESTS','.github','CONFIG','FINAL_GO_LIVE.cmd','PRE_FINAL_SOAK_RELEASE_CANDIDATE.cmd','package.json','package-lock.json')
    $trackedOutput=(& git status --porcelain --untracked-files=no -- $sourcePaths 2>&1 | Out-String).Trim(); $trackedEc=$LASTEXITCODE
    $untrackedOutput=(& git ls-files --others --exclude-standard -- $sourcePaths 2>&1 | Out-String).Trim(); $untrackedEc=$LASTEXITCODE
    $untracked=@(); if(-not [string]::IsNullOrWhiteSpace($untrackedOutput)){$untracked=@($untrackedOutput -split "`r?`n" | Where-Object {-not [string]::IsNullOrWhiteSpace($_)})}
    $localOperationalConfig=@($untracked | Where-Object { $_ -like 'CONFIG/*' })
    $backupArtifacts=@($untracked | Where-Object { $_ -match '\.backup_\d' -or $_ -match '\.(bak|old|orig)$' })
    $blockingUntracked=@($untracked | Where-Object { $_ -notlike 'CONFIG/*' -and $_ -notmatch '\.backup_\d' -and $_ -notmatch '\.(bak|old|orig)$' })

    $snapshotRows=@()
    foreach($relative in ($localOperationalConfig | Sort-Object)){
        $full=Join-Path $Root ($relative -replace '/','\')
        if(Test-Path -LiteralPath $full -PathType Leaf){$snapshotRows += "$relative=$((Get-FileHash -Algorithm SHA256 -LiteralPath $full).Hash)"}else{$snapshotRows += "$relative=MISSING"}
    }
    $snapshot=($snapshotRows -join ';')
    $configStable=$true
    if($Name -match 'before_validation'){$script:LocalOperationalConfigBaseline=$snapshot}
    elseif($Name -match 'after_validation'){$configStable=($snapshot -eq $script:LocalOperationalConfigBaseline)}

    $clean=($trackedEc -eq 0 -and $untrackedEc -eq 0 -and [string]::IsNullOrWhiteSpace($trackedOutput) -and $blockingUntracked.Count -eq 0 -and $configStable)
    $detail=[ordered]@{
        trackedDrift=if([string]::IsNullOrWhiteSpace($trackedOutput)){@()}else{@($trackedOutput -split "`r?`n")}
        blockingUntracked=$blockingUntracked
        localOperationalConfigCount=$localOperationalConfig.Count
        localOperationalConfigStable=$configStable
        localOperationalConfigSnapshot=$snapshotRows
        ignoredBackupArtifactCount=$backupArtifacts.Count
        ignoredBackupArtifacts=$backupArtifacts
    } | ConvertTo-Json -Depth 6 -Compress
    Add-Result $Name ($(if($clean){'GREEN'}else{'RED'})) 'SOURCE_CONTROL' ($(if($clean){0}else{2})) $detail
}

# Release-candidate identity must be exact before any live validation or mutation.
$fetchOutput=(& git fetch --quiet origin main 2>&1 | Out-String).Trim(); $fetchEc=$LASTEXITCODE
Add-Result 'git_fetch_origin_main' ($(if($fetchEc -eq 0){'GREEN'}else{'RED'})) 'SOURCE_CONTROL' $fetchEc $fetchOutput
if($fetchEc -eq 0){$originMain=(& git rev-parse origin/main).Trim()}
$identityOk=($branch -eq 'main' -and $head -eq $originMain -and -not [string]::IsNullOrWhiteSpace($originMain))
Add-Result 'release_candidate_identity' ($(if($identityOk){'GREEN'}else{'RED'})) 'SOURCE_CONTROL' ($(if($identityOk){0}else{2})) "branch=$branch head=$head originMain=$originMain"
Test-SourceDrift 'release_candidate_source_drift_before_validation'

$syntaxFiles=@(
'SCRIPTS/AuditInstantlyCampaignScheduleGovernance.js','SCRIPTS/AuditInstantlySendWindowHistory.js','SCRIPTS/RepairInstantlyWeekdaySchedules.js','SCRIPTS/AUDIT_MILES_REVENUE_OPERATIONS.js','SCRIPTS/AuditProposalCommandReadiness.js','SCRIPTS/AuditIonosExecutiveInboxReadOnly.js','SCRIPTS/AUDIT_OUTBOUND_SENDER_CAPACITY_V2.js',
'SERVICES/sales/P2GCSalesQualificationService.js','SERVICES/proposal/P2GCProposalCommandService.js','SERVICES/proposal/P2GCPostSubmissionLearningService.js','SERVICES/monica/MonicaDiscoveryCandidateService.js','SERVICES/revenue/IonosExecutiveTriageService.js','RUN_P2GC_PROPOSAL_COMMAND.js','StartP2GCGrowthBlueprintDemo.js',
'SERVICES/FederalPathwayScoreService.js','SERVICES/FederalPathwayScoreIntegratedService.js','SERVICES/revenue/RevenueWeightedCampaignScorecardService.js','SERVICES/revenue/QualifiedProspectNurtureService.js','SERVICES/revenue/P2GCAcquisitionV2CampaignService.js','SERVICES/revenue/P2GCAcquisitionV2ProspectEnrichmentService.js','SERVICES/revenue/P2GCWebsiteConversionAuditService.js',
'SERVICES/revenue/P2GCAuthorityContentProductionService.js','SERVICES/revenue/P2GCCompetitorExperimentService.js','SERVICES/revenue/P2GCBuyerLensContentService.js','SERVICES/revenue/P2GCLinkedInPublishingService.js','SERVICES/revenue/P2GCAcquisitionV2AcceptanceService.js','CONNECTORS/WEBSITE_B12/B12_CONTROLLED_PUBLISHER.js','CONNECTORS/LINKEDIN/LinkedInControlledPublisher.js',
'RUN_FEDERAL_PATHWAY_SCORE_INTEGRATED.js','RUN_P2GC_REVENUE_SCORECARD.js','RUN_P2GC_QUALIFIED_NURTURE.js','RUN_P2GC_ACQUISITION_V2_PILOT.js','RUN_P2GC_AUTHORITY_CONTENT.js','RUN_P2GC_COMPETITOR_EXPERIMENTS.js','RUN_P2GC_BUYER_LENS_CONTENT.js','RUN_P2GC_LINKEDIN_PUBLISH.js','RUN_P2GC_ACQUISITION_V2_ACCEPTANCE.js')
foreach($f in $syntaxFiles){Invoke-NodeCheck "syntax:$f" $f 'STATIC'}

$tests=@(
'TESTS/Test_InstantlyCampaignScheduleGovernance.js','TESTS/Test_InstantlySendWindowHistory.js','TESTS/Test_P2GCSalesQualificationDecisionLabels.js','TESTS/Test_P2GCProposalCommandService.js','TESTS/Test_P2GCPostSubmissionLearningService.js',
'TESTS/Test_MonicaDiscoveryAssessment.js','TESTS/Test_MonicaDiscoveryCandidateService.js','TESTS/Test_MonicaSourceAccessManifest.js',
'TESTS/Test_FederalPathwayScoreService.js','TESTS/Test_FederalPathwayScoreIntegratedService.js','TESTS/Test_RevenueWeightedCampaignScorecardService.js','TESTS/Test_QualifiedProspectNurtureService.js','TESTS/Test_P2GCAcquisitionV2CampaignService.js','TESTS/Test_P2GCAcquisitionV2ProspectEnrichmentService.js','TESTS/Test_P2GCB12ConversionManifest.js','TESTS/Test_P2GCWebsiteConversionAuditService.js','TESTS/Test_P2GCAuthorityContentProductionService.js','TESTS/Test_P2GCCompetitorExperimentService.js','TESTS/Test_P2GCBuyerLensContentService.js','TESTS/Test_P2GCLinkedInPublishingService.js','TESTS/Test_P2GCAcquisitionV2AcceptanceService.js',
'TESTS/E0030RevenueTruthGate.test.js','TESTS/meeting_pipeline_readonly_safety_test.js','TESTS/production_go_live_acceptance_audit_safety_test.js','TESTS/TestExecutiveDashboardData.js','TESTS/TestExecutiveMissionRouter.js','TESTS/TestExecutiveToEngineering.js','TESTS/TestExecutiveToEngineeringFlow.js')
foreach($t in $tests){Invoke-NodeRun "test:$t" $t @() 'TEST' $false}

# Known live schedule defect. Plan is read-only; execute is the one explicitly supported external mutation in this gate.
$repairReportPath=Join-Path $Root 'DATA\operational_acceptance\campaign_schedule_governance\INSTANTLY_WEEKDAY_REPAIR_LATEST.json'
Invoke-NodeRun 'instantly_weekday_repair_plan' 'SCRIPTS/RepairInstantlyWeekdaySchedules.js' @("--root=$Root") 'LIVE_READONLY' $false
if($ExecuteInstantlyWeekdayRepair){
    $oldDry=$env:MILES_DRY_RUN; $oldAllow=$env:MILES_ALLOW_INSTANTLY_MUTATIONS
    try{
        $env:MILES_DRY_RUN='false'
        $env:MILES_ALLOW_INSTANTLY_MUTATIONS='true'
        Invoke-NodeRun 'instantly_weekday_repair_execute' 'SCRIPTS/RepairInstantlyWeekdaySchedules.js' @("--root=$Root",'--execute') 'CONTROLLED_MUTATION' $true
    } finally {
        $env:MILES_DRY_RUN=$oldDry
        $env:MILES_ALLOW_INSTANTLY_MUTATIONS=$oldAllow
    }
    $executeEvidence=Read-JsonSafe $repairReportPath
    $unverified=if($executeEvidence){@($executeEvidence.changes | Where-Object {$_.verified -ne $true})}else{@('NO_EXECUTE_REPORT')}
    $executeVerified=($executeEvidence -and [string]$executeEvidence.mode -eq 'EXECUTE' -and $executeEvidence.ok -eq $true -and $unverified.Count -eq 0)
    Add-Result 'instantly_weekday_repair_execute_verification' ($(if($executeVerified){'GREEN'}else{'RED'})) 'CONTROLLED_MUTATION' ($(if($executeVerified){0}else{2})) ($(if($executeEvidence){$executeEvidence | ConvertTo-Json -Depth 8 -Compress}else{'NO_EXECUTE_REPORT'})) $true

    Invoke-NodeRun 'instantly_weekday_repair_readback_plan' 'SCRIPTS/RepairInstantlyWeekdaySchedules.js' @("--root=$Root") 'LIVE_READONLY' $false
    $readbackEvidence=Read-JsonSafe $repairReportPath
    $readbackVerified=($readbackEvidence -and [string]$readbackEvidence.mode -eq 'PLAN_ONLY' -and [int]$readbackEvidence.campaignsNeedingRepair -eq 0 -and @($readbackEvidence.blockers).Count -eq 0)
    Add-Result 'instantly_weekday_repair_postcheck' ($(if($readbackVerified){'GREEN'}else{'RED'})) 'LIVE_READONLY' ($(if($readbackVerified){0}else{2})) ($(if($readbackEvidence){$readbackEvidence | ConvertTo-Json -Depth 8 -Compress}else{'NO_READBACK_REPORT'}))
}

# Live production truth gates. No customer-facing mutations beyond the explicitly authorized weekday repair above.
Invoke-PowerShellRun 'production_acceptance' 'SCRIPTS/AUDIT_MILES_PRODUCTION_ACCEPTANCE.ps1' @('-Root',$Root) 'LIVE_READONLY'
Invoke-NodeRun 'revenue_operations' 'SCRIPTS/AUDIT_MILES_REVENUE_OPERATIONS.js' @($Root) 'LIVE_READONLY' $false
Invoke-NodeRun 'primary_inbox_coverage' 'SCRIPTS/AuditPrimaryInboxCoverage.js' @() 'LIVE_READONLY' $false
Invoke-NodeRun 'ionos_executive_inbox_readonly' 'SCRIPTS/AuditIonosExecutiveInboxReadOnly.js' @("--root=$Root") 'LIVE_READONLY' $false
Invoke-NodeRun 'outbound_sender_capacity_v2' 'SCRIPTS/AUDIT_OUTBOUND_SENDER_CAPACITY_V2.js' @($Root) 'LIVE_READONLY' $false
Invoke-NodeRun 'instantly_campaign_schedule_governance' 'SCRIPTS/AuditInstantlyCampaignScheduleGovernance.js' @() 'LIVE_READONLY' $false
# Pre-final readiness starts a fresh compliance boundary. Historical pre-repair Sunday sends remain evidence,
# but they do not force a 24-hour wait before the formal soak. The soak validates its own full start-to-finish window.
Invoke-NodeRun 'instantly_send_window_since_gate_start' 'SCRIPTS/AuditInstantlySendWindowHistory.js' @("--root=$Root","--since=$startedAt") 'LIVE_READONLY' $false

# Acquisition readiness. Explicitly disable campaign creation/activation and LinkedIn publishing.
$oldExec=$env:P2GC_ACQ_V2_EXECUTE; $oldActivate=$env:P2GC_ACQ_V2_ACTIVATE; $oldLi=$env:LINKEDIN_PUBLISH_ENABLED
try{
    $env:P2GC_ACQ_V2_EXECUTE='false';$env:P2GC_ACQ_V2_ACTIVATE='false';$env:LINKEDIN_PUBLISH_ENABLED='false'
    Invoke-NodeRun 'federal_pathway_score_integrated' 'RUN_FEDERAL_PATHWAY_SCORE_INTEGRATED.js' @() 'READINESS' $false
    Invoke-NodeRun 'revenue_weighted_campaign_scorecard' 'RUN_P2GC_REVENUE_SCORECARD.js' @() 'READINESS' $false
    Invoke-NodeRun 'qualified_prospect_nurture' 'RUN_P2GC_QUALIFIED_NURTURE.js' @() 'READINESS' $false
    Invoke-NodeRun 'acquisition_v2_pilot_no_mutation' 'RUN_P2GC_ACQUISITION_V2_PILOT.js' @() 'READINESS' $false
    Invoke-NodeRun 'authority_content_queue' 'RUN_P2GC_AUTHORITY_CONTENT.js' @() 'READINESS' $false
    Invoke-NodeRun 'competitor_experiment_queue' 'RUN_P2GC_COMPETITOR_EXPERIMENTS.js' @() 'READINESS' $false
    Invoke-NodeRun 'buyer_lens_queue' 'RUN_P2GC_BUYER_LENS_CONTENT.js' @() 'READINESS' $false
    Invoke-NodeRun 'acquisition_v2_acceptance_truth' 'RUN_P2GC_ACQUISITION_V2_ACCEPTANCE.js' @() 'READINESS' $false -Advisory
}finally{$env:P2GC_ACQ_V2_EXECUTE=$oldExec;$env:P2GC_ACQ_V2_ACTIVATE=$oldActivate;$env:LINKEDIN_PUBLISH_ENABLED=$oldLi}

Invoke-NodeRun 'proposal_command_readiness_inventory' 'SCRIPTS/AuditProposalCommandReadiness.js' @("--root=$Root") 'READINESS' $false
Test-SourceDrift 'release_candidate_source_drift_after_validation'

# Windows PowerShell 5.1 can throw "Argument types do not match" when a generic List[object]
# is embedded directly through @($results) inside an ordered hashtable. Snapshot it to a
# real object[] first, then build the report with explicit intermediate values.
$resultItems = $results.ToArray()
$red = @($resultItems | Where-Object { $_.status -eq 'RED' }).Count
$yellow = @($resultItems | Where-Object { $_.status -eq 'YELLOW' }).Count
$green = @($resultItems | Where-Object { $_.status -eq 'GREEN' }).Count
$mutations = @($resultItems | Where-Object { $_.externalMutation -eq $true }).Count
$statusText = if($red -eq 0){'PRE_FINAL_SOAK_READINESS_GREEN'}else{'PRE_FINAL_SOAK_READINESS_BLOCKED'}
$rules = @(
    'Release-candidate identity must be main == origin/main with no tracked source/control drift.',
    'Untracked CONFIG operational files are inventoried by SHA256 and must remain unchanged during the readiness run; backup artifacts do not block.',
    'No acquisition campaign creation/activation during readiness.',
    'No B12 public publish during readiness.',
    'No LinkedIn public publish during readiness.',
    'Instantly weekday repair is the only allowed external mutation and requires provider read-back plus a zero-remaining-repair postcheck.',
    'Pre-final send-window validation begins at this gate start; historical pre-repair violations remain evidence but are not a readiness wait timer.',
    'IONOS and sender-capacity checks are read-only.',
    'MONICA remains DISCOVERY_ONLY with outreach and campaign enrollment blocked.',
    'YELLOW is allowed only for explicit external-evidence/activation work that remains gated; RED blocks the final soak.',
    'Final 24-hour soak begins only after all RED blockers are resolved and one release-candidate commit is frozen.'
)
$result = [ordered]@{
    ok = ($red -eq 0)
    status = $statusText
    generatedAt = (Get-Date).ToUniversalTime().ToString('o')
    startedAt = $startedAt
    gitHead = $head
    gitOriginMain = $originMain
    gitBranch = $branch
    executeInstantlyWeekdayRepairRequested = [bool]$ExecuteInstantlyWeekdayRepair
    counts = [ordered]@{
        green = $green
        yellow = $yellow
        red = $red
        controlledMutations = $mutations
        total = $resultItems.Count
    }
    rules = $rules
    results = $resultItems
}
$result | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $outFile -Encoding UTF8
Write-Host ""
Write-Host "PRE-FINAL-SOAK READINESS: $($result.status)"
Write-Host "HEAD=$head"
Write-Host "ORIGIN_MAIN=$originMain"
Write-Host "BRANCH=$branch"
Write-Host "GREEN=$green YELLOW=$yellow RED=$red CONTROLLED_MUTATIONS=$mutations"
Write-Host "REPORT=$outFile"
if($red -gt 0){exit 2}
