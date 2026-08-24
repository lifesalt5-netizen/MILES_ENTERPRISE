param(
    [string]$Root = "C:\P2GC_Intelligence\MILES_ENTERPRISE"
)

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path $Root).Path
$env:MILES_ROOT = $Root
Set-Location $Root

$outDir = Join-Path $Root 'DATA\operational_acceptance\post_soak_master'
New-Item -ItemType Directory -Force $outDir | Out-Null
$outFile = Join-Path $outDir 'POST_SOAK_MASTER_AUDIT_LATEST.json'
$results = New-Object System.Collections.Generic.List[object]
$startedAt = (Get-Date).ToUniversalTime().ToString('o')
$head = (& git rev-parse HEAD).Trim()
$branch = (& git rev-parse --abbrev-ref HEAD).Trim()
$originMain = ''

function Add-Result {
    param(
        [string]$Name,
        [string]$Status,
        [string]$Category,
        [int]$ExitCode,
        [string]$Detail,
        [bool]$Mutation=$false
    )
    $results.Add([pscustomobject]@{
        name=$Name
        status=$Status
        category=$Category
        exitCode=$ExitCode
        detail=$Detail
        externalMutation=$Mutation
    }) | Out-Null
}

function Read-JsonSafe {
    param([string]$Path)
    if(-not(Test-Path -LiteralPath $Path -PathType Leaf)){return $null}
    try { Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json } catch { return $null }
}

function Invoke-NodeRun {
    param(
        [string]$Name,
        [string]$Path,
        [string[]]$Arguments=@(),
        [string]$Category='TEST',
        [switch]$Advisory
    )
    $full = Join-Path $Root $Path
    if(-not(Test-Path -LiteralPath $full -PathType Leaf)){
        Add-Result $Name 'YELLOW' $Category 0 "MISSING:$Path"
        return
    }
    $output = & node $full @Arguments 2>&1 | Out-String
    $ec = $LASTEXITCODE
    $tail = if($output.Length -gt 5000){$output.Substring($output.Length-5000)}else{$output}
    $status = if($ec -eq 0){'GREEN'}elseif($Advisory){'YELLOW'}else{'RED'}
    Add-Result $Name $status $Category $ec $tail.Trim()
}

function Invoke-PowerShellRun {
    param(
        [string]$Name,
        [string]$Path,
        [string[]]$Arguments=@(),
        [string]$Category='LIVE_READONLY',
        [switch]$Advisory
    )
    $full = Join-Path $Root $Path
    if(-not(Test-Path -LiteralPath $full -PathType Leaf)){
        Add-Result $Name 'YELLOW' $Category 0 "MISSING:$Path"
        return
    }
    $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $full @Arguments 2>&1 | Out-String
    $ec = $LASTEXITCODE
    $tail = if($output.Length -gt 5000){$output.Substring($output.Length-5000)}else{$output}
    $status = if($ec -eq 0){'GREEN'}elseif($Advisory){'YELLOW'}else{'RED'}
    Add-Result $Name $status $Category $ec $tail.Trim()
}

function Find-LatestSuccessfulSoak {
    $base = Join-Path $Root 'DATA\operational_acceptance'
    if(-not(Test-Path -LiteralPath $base -PathType Container)){return $null}
    $files = Get-ChildItem -LiteralPath $base -Recurse -File -Filter 'MILES_24H_AUTONOMOUS_SOAK.json' -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending
    foreach($file in $files){
        $report = Read-JsonSafe $file.FullName
        if($report -and $report.ok -eq $true -and [string]$report.status -eq '24H_AUTONOMOUS_SOAK_GREEN'){
            return [pscustomobject]@{file=$file.FullName;report=$report}
        }
    }
    return $null
}

function Evaluate-GmailTriageSafety {
    $artifactPath = Join-Path $Root 'DATA\runtime\revenue\gmail_triage\gmail_executive_triage_latest.json'
    $artifact = Read-JsonSafe $artifactPath
    if(-not $artifact){
        Add-Result 'personal_gmail_business_scope_isolation' 'RED' 'INBOUND_SAFETY' 2 'GMAIL_TRIAGE_ARTIFACT_MISSING_OR_UNREADABLE'
        return
    }

    $outOfScope = @($artifact.accounts | Where-Object { [string]$_.scope -eq 'OUT_OF_BUSINESS_SCOPE' })
    $unsafePersonal = @($outOfScope | Where-Object {
        $_.skipped -ne $true -or
        [int]$_.messagesInspected -ne 0 -or
        [int]$_.forwarded -ne 0 -or
        [int]$_.archived -ne 0
    })
    $personalSafe = ($outOfScope.Count -ge 1 -and $unsafePersonal.Count -eq 0)

    $componentsOk = (
        $artifact.ok -eq $true -and
        [string]$artifact.status -eq 'ACTIVE' -and
        $artifact.components.gmail.ok -eq $true -and
        $artifact.components.ionos.ok -eq $true -and
        $artifact.ionos.ok -eq $true -and
        [string]$artifact.ionos.mode -eq 'ACTIVE_READ_ONLY_MAILBOX'
    )

    $leasePath = Join-Path $Root 'DATA\runtime\runtime_generations\miles-autonomous-coo.json'
    $lease = Read-JsonSafe $leasePath
    $producerOk = (
        $lease -and $artifact.producer -and
        [string]$artifact.producer.runtimeName -eq 'miles-autonomous-coo' -and
        [string]$artifact.producer.runtimeGeneration -eq [string]$lease.generation -and
        [int]$artifact.producer.runtimeGuardPid -eq [int]$lease.guardPid -and
        [int]$artifact.producer.pid -eq [int]$lease.childPid -and
        [string]$artifact.producer.cwd -eq $Root
    )

    $detail = [ordered]@{
        generatedAt=$artifact.generatedAt
        status=$artifact.status
        ok=$artifact.ok
        outOfScopeAccounts=$outOfScope.Count
        unsafeOutOfScopeAccounts=$unsafePersonal.Count
        gmailComponentOk=$artifact.components.gmail.ok
        ionosComponentOk=$artifact.components.ionos.ok
        ionosMode=$artifact.ionos.mode
        producerRuntimeGeneration=$artifact.producer.runtimeGeneration
        leaseGeneration=if($lease){$lease.generation}else{$null}
        producerMatchesLease=$producerOk
    } | ConvertTo-Json -Depth 6 -Compress

    Add-Result 'personal_gmail_business_scope_isolation' ($(if($personalSafe){'GREEN'}else{'RED'})) 'INBOUND_SAFETY' ($(if($personalSafe){0}else{2})) $detail
    Add-Result 'gmail_ionos_combined_runtime_truth' ($(if($componentsOk -and $producerOk){'GREEN'}else{'RED'})) 'INBOUND_SAFETY' ($(if($componentsOk -and $producerOk){0}else{2})) $detail
}

Write-Host '============================================================'
Write-Host 'MILES POST-SOAK MASTER AUDIT'
Write-Host 'READ-ONLY / CONTROLLED INTERNAL TESTING'
Write-Host '============================================================'

# Exact current-main identity. This audit does not mutate provider configuration.
$fetchOutput = (& git fetch --quiet origin main 2>&1 | Out-String).Trim()
$fetchEc = $LASTEXITCODE
Add-Result 'git_fetch_origin_main' ($(if($fetchEc -eq 0){'GREEN'}else{'RED'})) 'SOURCE_CONTROL' $fetchEc $fetchOutput
if($fetchEc -eq 0){$originMain = (& git rev-parse origin/main).Trim()}
$identityOk = ($branch -eq 'main' -and $head -eq $originMain -and -not [string]::IsNullOrWhiteSpace($originMain))
Add-Result 'post_soak_main_identity' ($(if($identityOk){'GREEN'}else{'RED'})) 'SOURCE_CONTROL' ($(if($identityOk){0}else{2})) "branch=$branch head=$head originMain=$originMain"

# Preserve the already-completed soak as acceptance evidence. Do not rerun it.
$soak = Find-LatestSuccessfulSoak
if($soak){
    $detail = [ordered]@{
        status=$soak.report.status
        acceptedProductionHead=$soak.report.acceptedProductionHead
        observedDurationHours=$soak.report.observedDurationHours
        sampleCount=$soak.report.sampleCount
        runtimeGreenAllSamples=$soak.report.runtimeGreenAllSamples
        revenueGreenAllSamples=$soak.report.revenueGreenAllSamples
        primaryInboxGreenAllSamples=$soak.report.primaryInboxGreenAllSamples
        campaignScheduleGreenAllSamples=$soak.report.campaignScheduleGreenAllSamples
        sendWindowGreenAllSamples=$soak.report.sendWindowGreenAllSamples
        report=$soak.file
    } | ConvertTo-Json -Depth 6 -Compress
    Add-Result 'completed_24h_autonomous_soak' 'GREEN' 'ACCEPTED_BASELINE' 0 $detail
}else{
    Add-Result 'completed_24h_autonomous_soak' 'RED' 'ACCEPTED_BASELINE' 2 'NO_SUCCESSFUL_24H_AUTONOMOUS_SOAK_ARTIFACT_FOUND'
}

# Current production/live read-only truth.
Invoke-PowerShellRun 'production_runtime_acceptance' 'SCRIPTS/AUDIT_MILES_PRODUCTION_ACCEPTANCE.ps1' @('-Root',$Root) 'LIVE_READONLY'
Invoke-NodeRun 'full_product_functional_acceptance' 'SCRIPTS/AUDIT_MILES_FULL_PRODUCT_FUNCTIONAL_ACCEPTANCE.js' @($Root) 'LIVE_READONLY'
Invoke-NodeRun 'revenue_operations' 'SCRIPTS/AUDIT_MILES_REVENUE_OPERATIONS.js' @($Root) 'LIVE_READONLY'
Invoke-NodeRun 'primary_inbox_coverage' 'SCRIPTS/AuditPrimaryInboxCoverage.js' @() 'LIVE_READONLY'
Invoke-NodeRun 'ionos_executive_inbox_readonly' 'SCRIPTS/AuditIonosExecutiveInboxReadOnly.js' @("--root=$Root") 'LIVE_READONLY'
Invoke-NodeRun 'outbound_sender_capacity_v2' 'SCRIPTS/AUDIT_OUTBOUND_SENDER_CAPACITY_V2.js' @($Root) 'LIVE_READONLY'
Invoke-NodeRun 'instantly_campaign_schedule_governance' 'SCRIPTS/AuditInstantlyCampaignScheduleGovernance.js' @() 'LIVE_READONLY'
Invoke-NodeRun 'instantly_send_window_last24h' 'SCRIPTS/AuditInstantlySendWindowHistory.js' @("--root=$Root") 'LIVE_READONLY'
Evaluate-GmailTriageSafety

# Runtime ownership / autonomous operating core.
$coreTests = @(
    'TESTS/single_taskqueue_executor_test.js',
    'TESTS/single_coo_planner_test.js',
    'TESTS/full_runtime_stability_test.js',
    'TESTS/TestExecutiveDashboardData.js',
    'TESTS/TestExecutiveMissionRouter.js',
    'TESTS/TestExecutiveToEngineering.js',
    'TESTS/TestExecutiveToEngineeringFlow.js'
)
foreach($t in $coreTests){Invoke-NodeRun "test:$t" $t @() 'AUTONOMOUS_CORE'}

# Workspace/Instantly/lead/reply/CRM/meeting closed-loop control-plane acceptance.
$revenueTests = @(
    'TESTS/full_product_functional_acceptance_test.js',
    'TESTS/Test_OutboundSendingGovernance.js',
    'TESTS/Test_RevenueOutboundReadinessAudit.js',
    'TESTS/Test_RevenueSegmentConfigurationApply.js',
    'TESTS/Test_StateRevenueDeploymentRunner.js',
    'TESTS/Test_LeadSupplyChainCloseoutV8.js',
    'TESTS/reply_intelligence_classification_test.js',
    'TESTS/reply_intelligence_production_loop_test.js',
    'TESTS/executive_reply_surface_policy_test.js',
    'TESTS/replacement_contact_recovery_test.js',
    'TESTS/replacement_contact_execution_test.js',
    'TESTS/Test_InstantlyGuardedReplySend.js',
    'TESTS/Test_AutonomousQualifiedReplyPolicy.js',
    'TESTS/Test_QualifiedReplyRevenueBridge.js',
    'TESTS/Test_QualifiedReplyWorkerExecution.js',
    'TESTS/Test_InstantlyMutationExecutionTruth.js',
    'TESTS/Test_RevenueCrmProgression.js',
    'TESTS/Test_CooRevenueCrmProgressionWiring.js',
    'TESTS/Test_OutboundToMeetingEndToEnd.js',
    'TESTS/Test_GmailExecutiveTriageService.js',
    'TESTS/Test_GmailExecutiveTriageProductionLoopStatus.js'
)
foreach($t in $revenueTests){Invoke-NodeRun "test:$t" $t @() 'REVENUE_CHAIN'}

# MONICA remains research-only. Safety/readiness is GREEN; measured harvest progress is tracked separately in #169.
$monicaTests = @(
    'TESTS/Test_MonicaDiscoveryAssessment.js',
    'TESTS/Test_MonicaDiscoveryCandidateService.js',
    'TESTS/Test_MonicaSourceAccessManifest.js'
)
foreach($t in $monicaTests){Invoke-NodeRun "test:$t" $t @() 'MONICA_DISCOVERY_ONLY'}
Add-Result 'monica_phase1_provenance_backed_harvest_measurement' 'YELLOW' 'MONICA_DISCOVERY_ONLY' 0 'Issue #169 remains open: source/provenance/suppression controls are merged, but real provenance-backed candidate counts and evidence-quality measurements are not yet accepted. Outreach remains blocked.'

# Proposal Command capability is tested, but external real-submission proof is a separate customer-facing acceptance boundary.
$proposalTests = @(
    'TESTS/Test_P2GCSalesQualificationDecisionLabels.js',
    'TESTS/Test_P2GCProposalCommandService.js',
    'TESTS/Test_P2GCPostSubmissionLearningService.js'
)
foreach($t in $proposalTests){Invoke-NodeRun "test:$t" $t @() 'PROPOSAL'}
Invoke-NodeRun 'proposal_command_readiness' 'SCRIPTS/AuditProposalCommandReadiness.js' @() 'PROPOSAL' -Advisory

# Acquisition V2 was intentionally held through the soak. Audit readiness without activating campaigns or publishing.
$oldExec=$env:P2GC_ACQ_V2_EXECUTE
$oldActivate=$env:P2GC_ACQ_V2_ACTIVATE
$oldLi=$env:LINKEDIN_PUBLISH_ENABLED
try {
    $env:P2GC_ACQ_V2_EXECUTE='false'
    $env:P2GC_ACQ_V2_ACTIVATE='false'
    $env:LINKEDIN_PUBLISH_ENABLED='false'
    $acqTests = @(
        'TESTS/Test_FederalPathwayScoreService.js',
        'TESTS/Test_FederalPathwayScoreIntegratedService.js',
        'TESTS/Test_RevenueWeightedCampaignScorecardService.js',
        'TESTS/Test_QualifiedProspectNurtureService.js',
        'TESTS/Test_P2GCAcquisitionV2CampaignService.js',
        'TESTS/Test_P2GCAcquisitionV2ProspectEnrichmentService.js',
        'TESTS/Test_P2GCB12ConversionManifest.js',
        'TESTS/Test_P2GCWebsiteConversionAuditService.js',
        'TESTS/Test_P2GCAuthorityContentProductionService.js',
        'TESTS/Test_P2GCCompetitorExperimentService.js',
        'TESTS/Test_P2GCBuyerLensContentService.js',
        'TESTS/Test_P2GCLinkedInPublishingService.js',
        'TESTS/Test_P2GCAcquisitionV2AcceptanceService.js'
    )
    foreach($t in $acqTests){Invoke-NodeRun "test:$t" $t @() 'ACQUISITION_V2'}
    Invoke-NodeRun 'acquisition_v2_acceptance_truth' 'RUN_P2GC_ACQUISITION_V2_ACCEPTANCE.js' @() 'ACQUISITION_V2' -Advisory
} finally {
    $env:P2GC_ACQ_V2_EXECUTE=$oldExec
    $env:P2GC_ACQ_V2_ACTIVATE=$oldActivate
    $env:LINKEDIN_PUBLISH_ENABLED=$oldLi
}

# Canonical summary.
$items = $results.ToArray()
$green = @($items | Where-Object {$_.status -eq 'GREEN'}).Count
$yellow = @($items | Where-Object {$_.status -eq 'YELLOW'}).Count
$red = @($items | Where-Object {$_.status -eq 'RED'}).Count
$report = [ordered]@{
    audit='MILES_POST_SOAK_MASTER_AUDIT'
    status=if($red -eq 0){'POST_SOAK_MASTER_AUDIT_NO_RED'}else{'POST_SOAK_MASTER_AUDIT_BLOCKED'}
    startedAt=$startedAt
    completedAt=(Get-Date).ToUniversalTime().ToString('o')
    head=$head
    originMain=$originMain
    branch=$branch
    summary=[ordered]@{green=$green;yellow=$yellow;red=$red;total=$items.Count}
    interpretation=[ordered]@{
        red='Real blocker requiring repair before #200 can close.'
        yellow='Known incomplete/gated post-soak work; not silently promoted to GREEN.'
        green='Current evidence passes the applicable gate.'
    }
    externalMutationsByAudit=$false
    reruns24hSoak=$false
    results=$items
}
$report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $outFile -Encoding UTF8

Write-Host ''
Write-Host "POST-SOAK MASTER AUDIT: $($report.status)"
Write-Host "HEAD=$head"
Write-Host "ORIGIN_MAIN=$originMain"
Write-Host "BRANCH=$branch"
Write-Host "GREEN=$green YELLOW=$yellow RED=$red TOTAL=$($items.Count)"
Write-Host "REPORT=$outFile"

if($red -gt 0){
    Write-Host ''
    Write-Host 'RED BLOCKERS:' -ForegroundColor Red
    $items | Where-Object {$_.status -eq 'RED'} | Select-Object name,category,exitCode,detail | Format-List
    exit 2
}

if($yellow -gt 0){
    Write-Host ''
    Write-Host 'YELLOW / REMAINING POST-SOAK WORK:' -ForegroundColor Yellow
    $items | Where-Object {$_.status -eq 'YELLOW'} | Select-Object name,category,exitCode,detail | Format-List
}

Write-Host ''
Write-Host 'POST_SOAK_MASTER_AUDIT_NO_RED'
exit 0
