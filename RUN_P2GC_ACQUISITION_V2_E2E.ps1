param(
    [switch]$ExecuteInstantly,
    [switch]$ActivateInstantly,
    [switch]$StageWebsite,
    [switch]$PublishWebsite,
    [string]$PathwayScoreTerm = ""
)

$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root
if (-not $env:MILES_ROOT) { $env:MILES_ROOT = $Root }

$Results = @()
function Add-Result([string]$Name, [string]$Status, [int]$ExitCode, [string]$Detail = "") {
    $script:Results += [PSCustomObject]@{
        name = $Name
        status = $Status
        exit_code = $ExitCode
        detail = $Detail
        completed_at = (Get-Date).ToString('o')
    }
}
function Invoke-NodeStep([string]$Name, [string]$Script, [string[]]$Args = @(), [switch]$Required) {
    Write-Host "`n=== $Name ==="
    & node $Script @Args
    $code = $LASTEXITCODE
    $status = if ($code -eq 0) { 'PASS' } elseif ($Required) { 'FAIL' } else { 'WARN' }
    Add-Result $Name $status $code $Script
    if ($Required -and $code -ne 0) { throw "Required step failed: $Name ($code)" }
}
function Invoke-PsStep([string]$Name, [string]$Script, [string[]]$Args = @(), [switch]$Required) {
    Write-Host "`n=== $Name ==="
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $Script @Args
    $code = $LASTEXITCODE
    $status = if ($code -eq 0) { 'PASS' } elseif ($Required) { 'FAIL' } else { 'WARN' }
    Add-Result $Name $status $code $Script
    if ($Required -and $code -ne 0) { throw "Required step failed: $Name ($code)" }
}

$startedAt = (Get-Date).ToString('o')
$failure = $null

try {
    $tests = @(
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
        'TESTS/Test_P2GCBuyerLensContentService.js'
    )
    foreach ($test in $tests) { Invoke-NodeStep "Regression: $test" $test -Required }

    Invoke-NodeStep 'Authority content production queue' 'RUN_P2GC_AUTHORITY_CONTENT.js' -Required
    Invoke-NodeStep 'Buyer Lens current-news content queue' 'RUN_P2GC_BUYER_LENS_CONTENT.js' -Required
    Invoke-NodeStep 'Competitor-to-experiment queue' 'RUN_P2GC_COMPETITOR_EXPERIMENTS.js' -Required

    Invoke-NodeStep 'Revenue-weighted campaign scorecard' 'RUN_P2GC_REVENUE_SCORECARD.js'

    $oldDryRun = $env:MILES_DRY_RUN
    $oldAllowMut = $env:MILES_ALLOW_INSTANTLY_MUTATIONS
    $oldControlled = $env:MILES_CONTROLLED_WRITE_ENABLED
    $oldInstantlyWrite = $env:INSTANTLY_WRITE_ENABLED
    $oldNurture = $env:P2GC_NURTURE_EXECUTE
    $oldAcq = $env:P2GC_ACQ_V2_EXECUTE
    $oldActivate = $env:P2GC_ACQ_V2_ACTIVATE

    if ($ExecuteInstantly) {
        $env:MILES_DRY_RUN = 'false'
        $env:MILES_ALLOW_INSTANTLY_MUTATIONS = 'true'
        $env:MILES_CONTROLLED_WRITE_ENABLED = 'true'
        $env:INSTANTLY_WRITE_ENABLED = 'true'
        $env:P2GC_NURTURE_EXECUTE = 'true'
        $env:P2GC_ACQ_V2_EXECUTE = 'true'
        $env:P2GC_ACQ_V2_ACTIVATE = if ($ActivateInstantly) { 'true' } else { 'false' }
    } else {
        $env:MILES_DRY_RUN = 'true'
        $env:P2GC_NURTURE_EXECUTE = 'false'
        $env:P2GC_ACQ_V2_EXECUTE = 'false'
        $env:P2GC_ACQ_V2_ACTIVATE = 'false'
    }

    Invoke-NodeStep 'Qualified-prospect nurture' 'RUN_P2GC_QUALIFIED_NURTURE.js'
    Invoke-NodeStep 'Evidence-qualified Instantly V2 pilot' 'RUN_P2GC_ACQUISITION_V2_PILOT.js'

    $env:MILES_DRY_RUN = $oldDryRun
    $env:MILES_ALLOW_INSTANTLY_MUTATIONS = $oldAllowMut
    $env:MILES_CONTROLLED_WRITE_ENABLED = $oldControlled
    $env:INSTANTLY_WRITE_ENABLED = $oldInstantlyWrite
    $env:P2GC_NURTURE_EXECUTE = $oldNurture
    $env:P2GC_ACQ_V2_EXECUTE = $oldAcq
    $env:P2GC_ACQ_V2_ACTIVATE = $oldActivate

    if ($PathwayScoreTerm) {
        Invoke-NodeStep 'Integrated Federal Pathway Score live evaluation' 'RUN_FEDERAL_PATHWAY_SCORE_INTEGRATED.js' @($PathwayScoreTerm)
    } else {
        Add-Result 'Integrated Federal Pathway Score live evaluation' 'SKIPPED' 0 'Provide -PathwayScoreTerm to run a named live evaluation.'
    }

    if ($PublishWebsite -and -not $StageWebsite) { $StageWebsite = $true }
    if ($StageWebsite) {
        $oldDryRun2 = $env:MILES_DRY_RUN
        $oldControlled2 = $env:MILES_CONTROLLED_WRITE_ENABLED
        $oldB12Write = $env:B12_WRITE_ENABLED
        $oldB12Publish = $env:B12_PUBLISH_ENABLED
        $env:MILES_DRY_RUN = 'false'
        $env:MILES_CONTROLLED_WRITE_ENABLED = 'true'
        $env:B12_WRITE_ENABLED = 'true'
        $env:B12_PUBLISH_ENABLED = if ($PublishWebsite) { 'true' } else { 'false' }
        $args = @('-Apply')
        if ($PublishWebsite) { $args += '-Publish' }
        Invoke-PsStep 'B12 controlled conversion deployment' 'CONNECTORS/WEBSITE_B12/RUN_CONTROLLED_PUBLISH_V2.ps1' $args
        $env:MILES_DRY_RUN = $oldDryRun2
        $env:MILES_CONTROLLED_WRITE_ENABLED = $oldControlled2
        $env:B12_WRITE_ENABLED = $oldB12Write
        $env:B12_PUBLISH_ENABLED = $oldB12Publish
    } else {
        Add-Result 'B12 controlled conversion deployment' 'SKIPPED' 0 'Use -StageWebsite; add -PublishWebsite only after staging passes.'
    }

    Invoke-NodeStep 'Public website conversion audit' 'SERVICES/revenue/P2GCWebsiteConversionAuditService.js'
    Invoke-NodeStep 'Final acquisition acceptance truth report' 'RUN_P2GC_ACQUISITION_V2_ACCEPTANCE.js'
}
catch {
    $failure = $_.Exception.Message
    Write-Error $failure
}
finally {
    $outDir = Join-Path $Root 'DATA\runtime\revenue\p2gc_acquisition_v2'
    New-Item -ItemType Directory -Force -Path $outDir | Out-Null
    $report = [ordered]@{
        service = 'P2GC_ACQUISITION_V2_E2E_RUNNER'
        started_at = $startedAt
        completed_at = (Get-Date).ToString('o')
        execute_instantly_requested = [bool]$ExecuteInstantly
        activate_instantly_requested = [bool]$ActivateInstantly
        stage_website_requested = [bool]$StageWebsite
        publish_website_requested = [bool]$PublishWebsite
        pathway_score_term_supplied = [bool]$PathwayScoreTerm
        failure = $failure
        results = $Results
        passed = @($Results | Where-Object { $_.status -eq 'PASS' }).Count
        warnings = @($Results | Where-Object { $_.status -eq 'WARN' }).Count
        failed = @($Results | Where-Object { $_.status -eq 'FAIL' }).Count
        skipped = @($Results | Where-Object { $_.status -eq 'SKIPPED' }).Count
        ok = (-not $failure) -and (@($Results | Where-Object { $_.status -eq 'FAIL' }).Count -eq 0)
    }
    $reportPath = Join-Path $outDir 'e2e_run_latest.json'
    $report | ConvertTo-Json -Depth 8 | Set-Content -Path $reportPath -Encoding UTF8
    Write-Host "`nE2E report: $reportPath"
    if (-not $report.ok) { exit 1 }
}
