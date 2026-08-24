param(
    [string]$Root = "C:\P2GC_Intelligence\MILES_ENTERPRISE"
)

$ErrorActionPreference = 'Continue'
$Root = (Resolve-Path $Root).Path
$env:MILES_ROOT = $Root
Set-Location $Root

$outDir = Join-Path $Root 'DATA\operational_acceptance\post_soak_remediation'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$outFile = Join-Path $outDir 'POST_SOAK_YELLOW_REMEDIATION_LATEST.json'
$results = New-Object System.Collections.Generic.List[object]

function Add-Result([string]$Name,[string]$Status,[string]$Detail='') {
    $results.Add([pscustomobject]@{name=$Name;status=$Status;detail=$Detail;at=(Get-Date).ToUniversalTime().ToString('o')}) | Out-Null
    Write-Host ("{0}: {1}{2}" -f $Name,$Status,$(if($Detail){" - $Detail"}else{''}))
}
function Read-JsonSafe([string]$Path) {
    if(-not(Test-Path -LiteralPath $Path -PathType Leaf)){return $null}
    try { return Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json } catch { return $null }
}
function Run-Node([string]$Name,[string]$Script) {
    Write-Host "`n=== $Name ==="
    & node $Script
    return $LASTEXITCODE
}

Write-Host '============================================================'
Write-Host 'MILES POST-SOAK YELLOW REMEDIATION'
Write-Host '============================================================'
Write-Host 'Safety: no new 24-hour soak; no LinkedIn publish; no public B12 publish; no Instantly mutation unless the precheck proves zero eligible actions.'

$head = (& git rev-parse HEAD).Trim()
$origin = (& git rev-parse origin/main).Trim()
if($head -ne $origin){ Add-Result 'release_identity' 'RED' "HEAD=$head origin/main=$origin" }
else { Add-Result 'release_identity' 'GREEN' "HEAD=$head" }

# MONICA: measure only real provenance-backed Phase-1 harvest files. No outreach.
$monicaCode = Run-Node 'MONICA Phase-1 provenance-backed measurement' 'SCRIPTS/RunMonicaPhase1HarvestMeasurement.js'
$monicaReport = Read-JsonSafe (Join-Path $Root 'DATA\MONICA\PHASE1_MEASUREMENT\latest.json')
if($monicaCode -eq 0 -and $monicaReport -and $monicaReport.ok -eq $true){
    Add-Result 'monica_phase1_measurement' 'GREEN' "candidates=$($monicaReport.candidateCount)"
} else {
    Add-Result 'monica_phase1_measurement' 'YELLOW' ($(if($monicaReport){[string]$monicaReport.status}else{'NO_REPORT'}))
}

# Nurture: first build a read-only plan. Only rerun execute=true when there are ZERO due actions.
$oldNurture = $env:P2GC_NURTURE_EXECUTE
$env:P2GC_NURTURE_EXECUTE = 'false'
$nurturePlanCode = Run-Node 'Qualified nurture plan' 'RUN_P2GC_QUALIFIED_NURTURE.js'
$nurturePath = Join-Path $Root 'DATA\runtime\revenue\nurture\run_once_latest.json'
$nurturePlan = Read-JsonSafe $nurturePath
$due = if($nurturePlan){[int]$nurturePlan.result.dueQueued}else{-1}
if($nurturePlanCode -eq 0 -and $nurturePlan -and $due -eq 0){
    $env:P2GC_NURTURE_EXECUTE = 'true'
    $nurtureExecuteCode = Run-Node 'Qualified nurture zero-action live execution proof' 'RUN_P2GC_QUALIFIED_NURTURE.js'
    $nurtureLive = Read-JsonSafe $nurturePath
    $attempted = if($nurtureLive){[int]$nurtureLive.result.execution.attempted}else{-1}
    if($nurtureExecuteCode -eq 0 -and $nurtureLive.executeRequested -eq $true -and $attempted -eq 0){
        Add-Result 'nurture_live_truth' 'GREEN' 'executeRequested=true; attempted=0; no external mutation required'
    } else { Add-Result 'nurture_live_truth' 'RED' 'Zero-action execution proof did not validate.' }
} elseif($nurturePlanCode -eq 0 -and $due -gt 0) {
    Add-Result 'nurture_live_truth' 'YELLOW' "dueQueued=$due; not auto-sent by remediation runner"
} else { Add-Result 'nurture_live_truth' 'RED' 'Unable to build nurture plan.' }
$env:P2GC_NURTURE_EXECUTE = $oldNurture

# Acquisition V2 pilot: plan first. Only set execute=true when evidence-qualified accepted leads are exactly zero.
$oldAcq = $env:P2GC_ACQ_V2_EXECUTE
$oldActivate = $env:P2GC_ACQ_V2_ACTIVATE
$env:P2GC_ACQ_V2_EXECUTE = 'false'
$env:P2GC_ACQ_V2_ACTIVATE = 'false'
$pilotPlanCode = Run-Node 'Acquisition V2 pilot plan' 'RUN_P2GC_ACQUISITION_V2_PILOT.js'
$pilotPath = Join-Path $Root 'DATA\runtime\revenue\p2gc_acquisition_v2\pilot_deployment_latest.json'
$pilotPlan = Read-JsonSafe $pilotPath
$accepted = if($pilotPlan){[int]$pilotPlan.enrichment.accepted}else{-1}
if($pilotPlanCode -eq 0 -and $pilotPlan -and $accepted -eq 0){
    $env:P2GC_ACQ_V2_EXECUTE = 'true'
    $env:P2GC_ACQ_V2_ACTIVATE = 'false'
    $pilotExecuteCode = Run-Node 'Acquisition V2 zero-lead live execution proof' 'RUN_P2GC_ACQUISITION_V2_PILOT.js'
    $pilotLive = Read-JsonSafe $pilotPath
    if($pilotExecuteCode -eq 0 -and $pilotLive.executeRequested -eq $true -and [int]$pilotLive.enrichment.accepted -eq 0 -and [string]$pilotLive.executionTruth -eq 'NO_EXTERNAL_MUTATION'){
        Add-Result 'acquisition_v2_pilot_live_truth' 'GREEN' 'executeRequested=true; accepted=0; NO_EXTERNAL_MUTATION'
    } else { Add-Result 'acquisition_v2_pilot_live_truth' 'RED' 'Zero-lead execution proof did not validate.' }
} elseif($pilotPlanCode -eq 0 -and $accepted -gt 0) {
    Add-Result 'acquisition_v2_pilot_live_truth' 'YELLOW' "accepted=$accepted; remediation runner will not mutate Instantly automatically"
} else { Add-Result 'acquisition_v2_pilot_live_truth' 'RED' 'Unable to build pilot plan.' }
$env:P2GC_ACQ_V2_EXECUTE = $oldAcq
$env:P2GC_ACQ_V2_ACTIVATE = $oldActivate

# B12: staging is allowed post-soak, but public publish remains explicitly disabled.
Write-Host "`n=== B12 controlled staging (NO PUBLIC PUBLISH) ==="
$oldDry = $env:MILES_DRY_RUN; $oldControlled = $env:MILES_CONTROLLED_WRITE_ENABLED; $oldB12Write = $env:B12_WRITE_ENABLED; $oldB12Publish = $env:B12_PUBLISH_ENABLED
try {
    $env:MILES_DRY_RUN = 'false'
    $env:MILES_CONTROLLED_WRITE_ENABLED = 'true'
    $env:B12_WRITE_ENABLED = 'true'
    $env:B12_PUBLISH_ENABLED = 'false'
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File 'CONNECTORS\WEBSITE_B12\RUN_CONTROLLED_PUBLISH_V2.ps1' -Apply
    $b12Code = $LASTEXITCODE
} finally {
    $env:MILES_DRY_RUN = $oldDry; $env:MILES_CONTROLLED_WRITE_ENABLED = $oldControlled; $env:B12_WRITE_ENABLED = $oldB12Write; $env:B12_PUBLISH_ENABLED = $oldB12Publish
}
$b12Path = Join-Path $Root 'DATA\website_ops\b12_conversion_v2\latest.json'
$b12 = Read-JsonSafe $b12Path
if($b12Code -eq 0 -and $b12 -and $b12.staging.ok -eq $true){ Add-Result 'b12_staging' 'GREEN' ([string]$b12.status) }
elseif($b12 -and [string]$b12.status -eq 'AUTHENTICATED_B12_SESSION_REQUIRED'){ Add-Result 'b12_staging' 'YELLOW' 'AUTHENTICATED_B12_SESSION_REQUIRED' }
else { Add-Result 'b12_staging' 'YELLOW' ($(if($b12){[string]$b12.status}else{"exit=$b12Code; NO_REPORT"})) }

# Website public audit is read-only.
Run-Node 'Public website conversion audit' 'SERVICES/revenue/P2GCWebsiteConversionAuditService.js' | Out-Null
$websiteAudit = Read-JsonSafe (Join-Path $Root 'DATA\website_ops\p2gc_conversion_audit\latest.json')
if($websiteAudit -and $websiteAudit.ok -eq $true){ Add-Result 'website_public_audit' 'GREEN' 'Public conversion truth verified.' }
else { Add-Result 'website_public_audit' 'YELLOW' 'Public publish/audit not yet complete.' }

# LinkedIn: create current channel artifact only; publishing remains disabled.
$oldLiDry = $env:MILES_DRY_RUN; $oldLiPublish = $env:P2GC_LINKEDIN_PUBLISH; $oldLiWrite = $env:LINKEDIN_WRITE_ENABLED
try {
    $env:MILES_DRY_RUN = 'true'
    $env:P2GC_LINKEDIN_PUBLISH = 'false'
    $env:LINKEDIN_WRITE_ENABLED = 'false'
    Run-Node 'LinkedIn channel readiness / no-publish run' 'RUN_P2GC_LINKEDIN_PUBLISH.js' | Out-Null
} finally {
    $env:MILES_DRY_RUN = $oldLiDry; $env:P2GC_LINKEDIN_PUBLISH = $oldLiPublish; $env:LINKEDIN_WRITE_ENABLED = $oldLiWrite
}
$linkedin = Read-JsonSafe (Join-Path $Root 'DATA\marketing_coo\linkedin_publish\latest.json')
if($linkedin -and [string]$linkedin.status -eq 'NO_DUE_READY_POST'){ Add-Result 'linkedin_channel' 'GREEN' 'NO_DUE_READY_POST' }
elseif($linkedin){ Add-Result 'linkedin_channel' 'YELLOW' ([string]$linkedin.status) }
else { Add-Result 'linkedin_channel' 'YELLOW' 'NO_LINKEDIN_RUNTIME_ARTIFACT' }

# Final acquisition acceptance and master audit truth.
$acceptCode = Run-Node 'Final Acquisition V2 acceptance truth' 'RUN_P2GC_ACQUISITION_V2_ACCEPTANCE.js'
$acceptPath = Join-Path $Root 'DATA\runtime\revenue\p2gc_acquisition_v2\final_acceptance_latest.json'
$accept = Read-JsonSafe $acceptPath
if($accept -and $accept.ok -eq $true){ Add-Result 'acquisition_v2_final_acceptance' 'GREEN' ([string]$accept.status) }
else {
    $blockers = if($accept){(@($accept.blockers | ForEach-Object { "$($_.id):$($_.status)" }) -join ', ')}else{'NO_REPORT'}
    Add-Result 'acquisition_v2_final_acceptance' 'YELLOW' $blockers
}

$red = @($results | Where-Object {$_.status -eq 'RED'}).Count
$yellow = @($results | Where-Object {$_.status -eq 'YELLOW'}).Count
$green = @($results | Where-Object {$_.status -eq 'GREEN'}).Count
$report = [ordered]@{
    ok = ($red -eq 0)
    status = if($red -gt 0){'POST_SOAK_REMEDIATION_RED'}elseif($yellow -gt 0){'POST_SOAK_REMEDIATION_REMAINING_YELLOW'}else{'POST_SOAK_REMEDIATION_GREEN'}
    generatedAt = (Get-Date).ToUniversalTime().ToString('o')
    productionHead = $head
    counts = @{green=$green;yellow=$yellow;red=$red;total=$results.Count}
    results = $results
    acquisitionBlockers = if($accept){@($accept.blockers)}else{@()}
    safety = @{
        another24hSoakStarted = $false
        publicB12PublishExecutedByRunner = $false
        linkedinPublishExecutedByRunner = $false
        instantlyMutationAllowedOnlyForZeroEligibleActions = $true
        monicaOutreachExecuted = $false
    }
}
$report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $outFile -Encoding UTF8
Write-Host "`n============================================================"
Write-Host $report.status
Write-Host ("GREEN={0} YELLOW={1} RED={2}" -f $green,$yellow,$red)
Write-Host "REPORT=$outFile"
Write-Host '============================================================'
if($red -gt 0){ exit 2 }
exit 0
