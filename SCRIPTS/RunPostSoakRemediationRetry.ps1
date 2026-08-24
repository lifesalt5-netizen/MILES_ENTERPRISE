param(
    [string]$Root = "C:\P2GC_Intelligence\MILES_ENTERPRISE"
)

$ErrorActionPreference = 'Continue'
$Root = (Resolve-Path $Root).Path
$env:MILES_ROOT = $Root
Set-Location $Root

$outDir = Join-Path $Root 'DATA\operational_acceptance\post_soak_remediation'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$outFile = Join-Path $outDir 'POST_SOAK_REMEDIATION_RETRY_LATEST.json'
$results = New-Object System.Collections.Generic.List[object]

function Add-Result([string]$Name,[string]$Status,[string]$Detail='') {
    $results.Add([pscustomobject]@{name=$Name;status=$Status;detail=$Detail;at=(Get-Date).ToUniversalTime().ToString('o')}) | Out-Null
    Write-Host ("{0}: {1}{2}" -f $Name,$Status,$(if($Detail){" - $Detail"}else{''}))
}
function Read-JsonSafe([string]$Path) {
    if(-not(Test-Path -LiteralPath $Path -PathType Leaf)){return $null}
    try { return Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json } catch { return $null }
}
function Run-NodeVisible([string]$Name,[string]$Script) {
    Write-Host "`n=== $Name ==="
    & node $Script 2>&1 | ForEach-Object { Write-Host ([string]$_) }
    $code = $LASTEXITCODE
    return [int]$code
}

Write-Host '============================================================'
Write-Host 'MILES POST-SOAK REMEDIATION RETRY + LINKEDIN PROSPECT ASSIST'
Write-Host '============================================================'
Write-Host 'No new 24-hour soak. No LinkedIn connection/DM automation. No LinkedIn publish. No public B12 publish.'

$head = (& git rev-parse HEAD).Trim()
$origin = (& git rev-parse origin/main).Trim()
if($head -ne $origin){ Add-Result 'release_identity' 'RED' "HEAD=$head origin/main=$origin" }
else { Add-Result 'release_identity' 'GREEN' "HEAD=$head" }

# Recheck the two prior REDs with a stdout-safe exit-code harness.
$oldNurture = $env:P2GC_NURTURE_EXECUTE
try {
    $env:P2GC_NURTURE_EXECUTE = 'false'
    $nurtureCode = Run-NodeVisible 'Qualified nurture PLAN' 'RUN_P2GC_QUALIFIED_NURTURE.js'
    $nurturePath = Join-Path $Root 'DATA\runtime\revenue\nurture\run_once_latest.json'
    $nurture = Read-JsonSafe $nurturePath
    $due = if($nurture -and $nurture.result){[int]$nurture.result.dueQueued}else{-1}
    if($nurtureCode -eq 0 -and $nurture -and $due -eq 0){
        $env:P2GC_NURTURE_EXECUTE = 'true'
        $liveCode = Run-NodeVisible 'Qualified nurture zero-action execution truth' 'RUN_P2GC_QUALIFIED_NURTURE.js'
        $live = Read-JsonSafe $nurturePath
        $attempted = if($live -and $live.result -and $live.result.execution){[int]$live.result.execution.attempted}else{-1}
        if($liveCode -eq 0 -and $live.executeRequested -eq $true -and $attempted -eq 0){ Add-Result 'nurture_live_truth' 'GREEN' 'executeRequested=true; attempted=0; no mutation required' }
        else { Add-Result 'nurture_live_truth' 'RED' "liveExit=$liveCode attempted=$attempted" }
    } elseif($nurtureCode -eq 0 -and $due -gt 0) {
        Add-Result 'nurture_live_truth' 'YELLOW' "dueQueued=$due; no auto-send performed"
    } else {
        Add-Result 'nurture_live_truth' 'RED' "planExit=$nurtureCode reportPresent=$([bool]$nurture) due=$due"
    }
} finally { $env:P2GC_NURTURE_EXECUTE = $oldNurture }

$oldAcq = $env:P2GC_ACQ_V2_EXECUTE
$oldActivate = $env:P2GC_ACQ_V2_ACTIVATE
try {
    $env:P2GC_ACQ_V2_EXECUTE = 'false'
    $env:P2GC_ACQ_V2_ACTIVATE = 'false'
    $pilotCode = Run-NodeVisible 'Acquisition V2 pilot PLAN' 'RUN_P2GC_ACQUISITION_V2_PILOT.js'
    $pilotPath = Join-Path $Root 'DATA\runtime\revenue\p2gc_acquisition_v2\pilot_deployment_latest.json'
    $pilot = Read-JsonSafe $pilotPath
    $accepted = if($pilot -and $pilot.enrichment){[int]$pilot.enrichment.accepted}else{-1}
    if($pilotCode -eq 0 -and $pilot -and $accepted -eq 0){
        $env:P2GC_ACQ_V2_EXECUTE = 'true'
        $livePilotCode = Run-NodeVisible 'Acquisition V2 zero-lead execution truth' 'RUN_P2GC_ACQUISITION_V2_PILOT.js'
        $livePilot = Read-JsonSafe $pilotPath
        if($livePilotCode -eq 0 -and $livePilot.executeRequested -eq $true -and [int]$livePilot.enrichment.accepted -eq 0 -and [string]$livePilot.executionTruth -eq 'NO_EXTERNAL_MUTATION'){
            Add-Result 'acquisition_v2_pilot_live_truth' 'GREEN' 'executeRequested=true; accepted=0; NO_EXTERNAL_MUTATION'
        } else { Add-Result 'acquisition_v2_pilot_live_truth' 'RED' "liveExit=$livePilotCode" }
    } elseif($pilotCode -eq 0 -and $accepted -gt 0) {
        Add-Result 'acquisition_v2_pilot_live_truth' 'YELLOW' "accepted=$accepted; no Instantly mutation performed"
    } else {
        Add-Result 'acquisition_v2_pilot_live_truth' 'RED' "planExit=$pilotCode reportPresent=$([bool]$pilot) accepted=$accepted"
    }
} finally {
    $env:P2GC_ACQ_V2_EXECUTE = $oldAcq
    $env:P2GC_ACQ_V2_ACTIVATE = $oldActivate
}

# Build the assisted LinkedIn queue from real recently-sent Instantly prospects. Read-only to Instantly; no LinkedIn automation.
$assistCode = Run-NodeVisible 'LinkedIn Prospect Assist' 'RUN_P2GC_LINKEDIN_PROSPECT_ASSIST.js'
$assistPath = Join-Path $Root 'DATA\runtime\revenue\linkedin_prospect_assist\latest.json'
$assist = Read-JsonSafe $assistPath
if($assistCode -eq 0 -and $assist -and $assist.ok -eq $true){
    Add-Result 'linkedin_prospect_assist' 'GREEN' "prospects=$($assist.prospectCount); explicitProfiles=$($assist.explicitLinkedInProfiles); publicSearchRequired=$($assist.publicSearchRequired)"
} else {
    Add-Result 'linkedin_prospect_assist' 'RED' "exit=$assistCode reportPresent=$([bool]$assist)"
}

# Install B12 connector package dependencies if absent, then stage only. Never publish publicly.
$b12Root = Join-Path $Root 'CONNECTORS\WEBSITE_B12'
$playwrightDir = Join-Path $b12Root 'node_modules\playwright'
if(-not(Test-Path $playwrightDir) -and (Test-Path (Join-Path $b12Root 'package-lock.json'))){
    Write-Host "`n=== B12 dependency install (npm ci) ==="
    Push-Location $b12Root
    try { & npm ci; $npmCode = $LASTEXITCODE } finally { Pop-Location }
    if($npmCode -ne 0){ Add-Result 'b12_dependencies' 'YELLOW' "npm ci exit=$npmCode" }
    else { Add-Result 'b12_dependencies' 'GREEN' 'npm ci complete' }
} else { Add-Result 'b12_dependencies' 'GREEN' 'already present or package-lock unavailable' }

$oldDry = $env:MILES_DRY_RUN; $oldControlled = $env:MILES_CONTROLLED_WRITE_ENABLED; $oldB12Write = $env:B12_WRITE_ENABLED; $oldB12Publish = $env:B12_PUBLISH_ENABLED
try {
    $env:MILES_DRY_RUN = 'false'
    $env:MILES_CONTROLLED_WRITE_ENABLED = 'true'
    $env:B12_WRITE_ENABLED = 'true'
    $env:B12_PUBLISH_ENABLED = 'false'
    Write-Host "`n=== B12 staging only ==="
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File 'CONNECTORS\WEBSITE_B12\RUN_CONTROLLED_PUBLISH_V2.ps1' -Apply
    $b12Code = $LASTEXITCODE
} finally {
    $env:MILES_DRY_RUN = $oldDry; $env:MILES_CONTROLLED_WRITE_ENABLED = $oldControlled; $env:B12_WRITE_ENABLED = $oldB12Write; $env:B12_PUBLISH_ENABLED = $oldB12Publish
}
$b12 = Read-JsonSafe (Join-Path $Root 'DATA\website_ops\b12_conversion_v2\latest.json')
if($b12Code -eq 0 -and $b12 -and $b12.staging.ok -eq $true){ Add-Result 'b12_staging' 'GREEN' ([string]$b12.status) }
elseif($b12){ Add-Result 'b12_staging' 'YELLOW' ([string]$b12.status) }
else { Add-Result 'b12_staging' 'YELLOW' "exit=$b12Code; NO_REPORT" }

$red = @($results | Where-Object {$_.status -eq 'RED'}).Count
$yellow = @($results | Where-Object {$_.status -eq 'YELLOW'}).Count
$green = @($results | Where-Object {$_.status -eq 'GREEN'}).Count
$report = [ordered]@{
    ok = ($red -eq 0)
    status = if($red -gt 0){'POST_SOAK_RETRY_RED'}elseif($yellow -gt 0){'POST_SOAK_RETRY_REMAINING_YELLOW'}else{'POST_SOAK_RETRY_GREEN'}
    generatedAt = (Get-Date).ToUniversalTime().ToString('o')
    productionHead = $head
    counts = @{green=$green;yellow=$yellow;red=$red;total=$results.Count}
    results = $results
    linkedinAssist = if($assist){@{prospectCount=$assist.prospectCount;explicitProfiles=$assist.explicitLinkedInProfiles;publicSearchRequired=$assist.publicSearchRequired;htmlFile=(Join-Path $Root 'DATA\runtime\revenue\linkedin_prospect_assist\latest.html')}}else{$null}
    safety = @{
        another24hSoakStarted = $false
        linkedinScraping = $false
        automatedLinkedInConnections = $false
        automatedLinkedInDMs = $false
        linkedinPublishExecuted = $false
        publicB12PublishExecuted = $false
    }
}
$report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $outFile -Encoding UTF8
Write-Host "`n============================================================"
Write-Host $report.status
Write-Host ("GREEN={0} YELLOW={1} RED={2}" -f $green,$yellow,$red)
Write-Host "REPORT=$outFile"
if($assist){ Write-Host "LINKEDIN_ASSIST_HTML=$(Join-Path $Root 'DATA\runtime\revenue\linkedin_prospect_assist\latest.html')" }
Write-Host '============================================================'
if($red -gt 0){ exit 2 }
exit 0
