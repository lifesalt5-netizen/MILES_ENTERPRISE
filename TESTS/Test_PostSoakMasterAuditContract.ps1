$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$scriptPath = Join-Path $root 'SCRIPTS\RunPostSoakMasterAudit.ps1'
$launcherPath = Join-Path $root 'POST_SOAK_MASTER_AUDIT.cmd'

if(-not(Test-Path $scriptPath)){throw 'RunPostSoakMasterAudit.ps1 missing'}
if(-not(Test-Path $launcherPath)){throw 'POST_SOAK_MASTER_AUDIT.cmd missing'}

$script = Get-Content -Raw $scriptPath
$launcher = Get-Content -Raw $launcherPath

$required = @(
    'completed_24h_autonomous_soak',
    'full_product_functional_acceptance',
    'revenue_operations',
    'primary_inbox_coverage',
    'ionos_executive_inbox_readonly',
    'outbound_sender_capacity_v2',
    'instantly_campaign_schedule_governance',
    'instantly_send_window_last24h',
    'personal_gmail_business_scope_isolation',
    'gmail_ionos_combined_runtime_truth',
    'Test_OutboundToMeetingEndToEnd.js',
    'Test_GmailExecutiveTriageService.js',
    'Test_MonicaDiscoveryAssessment.js',
    'AuditProposalCommandReadiness.js',
    'RUN_P2GC_ACQUISITION_V2_ACCEPTANCE.js',
    'externalMutationsByAudit=$false',
    'reruns24hSoak=$false'
)
foreach($token in $required){
    if($script -notlike "*$token*"){throw "Missing required post-soak gate/token: $token"}
}

$forbidden = @(
    'RunMiles24hAutonomousSoak.ps1',
    'RepairInstantlyWeekdaySchedules.js',
    'MILES_ALLOW_INSTANTLY_MUTATIONS=''true''',
    'P2GC_ACQ_V2_EXECUTE=''true''',
    'P2GC_ACQ_V2_ACTIVATE=''true''',
    'LINKEDIN_PUBLISH_ENABLED=''true'''
)
foreach($token in $forbidden){
    if($script -like "*$token*"){throw "Forbidden mutation/soak token present: $token"}
}

if($launcher -notlike '*POST_SOAK_MASTER_AUDIT_COMPLETE*'){throw 'Launcher completion contract missing'}
if($launcher -notlike '*POST_SOAK_MASTER_AUDIT_BLOCKED*'){throw 'Launcher blocked contract missing'}
if($launcher -like '*FINAL_GO_LIVE.cmd*'){throw 'Launcher must not trigger FINAL_GO_LIVE.cmd'}
if($launcher -like '*RunMiles24hAutonomousSoak.ps1*'){throw 'Launcher must not trigger another soak'}

Write-Host 'POST_SOAK_MASTER_AUDIT_CONTRACT=GREEN'
