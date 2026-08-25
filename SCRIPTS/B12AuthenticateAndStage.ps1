param(
    [string]$Root = "C:\P2GC_Intelligence\MILES_ENTERPRISE"
)

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path $Root).Path
$env:MILES_ROOT = $Root
Set-Location $Root

$connectorRoot = Join-Path $Root 'CONNECTORS\WEBSITE_B12'
$profile = Join-Path $Root 'DATA\browser_profiles\b12_miles'
$singleSession = Join-Path $connectorRoot 'B12_AUTH_AND_STAGE_SINGLE_SESSION.js'
$latest = Join-Path $Root 'DATA\website_ops\b12_conversion_v2\latest.json'
$authLatest = Join-Path $Root 'DATA\website_ops\b12_auth\latest.json'

Write-Host '============================================================'
Write-Host 'P2GC B12 AUTHENTICATE + STAGE — SINGLE SESSION / RESUMABLE'
Write-Host '============================================================'
Write-Host 'This keeps authentication and staging inside the SAME B12 browser session.'
Write-Host 'Previously completed successful B12 draft operations may be resumed instead of repeated.'
Write-Host 'MILES does not capture or store your password.'
Write-Host 'This may edit B12 STAGING after login.'
Write-Host 'PUBLIC PUBLISH REMAINS DISABLED.'
Write-Host ''

if (-not (Test-Path (Join-Path $connectorRoot 'node_modules\playwright'))) {
    Write-Host 'Installing B12 connector dependencies...'
    Push-Location $connectorRoot
    try {
        & npm ci
        if ($LASTEXITCODE -ne 0) { throw "B12 npm ci failed with exit $LASTEXITCODE" }
    } finally {
        Pop-Location
    }
}

$oldDry = $env:MILES_DRY_RUN
$oldControlled = $env:MILES_CONTROLLED_WRITE_ENABLED
$oldWrite = $env:B12_WRITE_ENABLED
$oldPublish = $env:B12_PUBLISH_ENABLED
$oldApply = $env:P2GC_B12_APPLY
$oldRequestedPublish = $env:P2GC_B12_PUBLISH
$oldResume = $env:B12_RESUME_SUCCESSFUL_OPERATIONS
$oldProfile = $env:B12_USER_DATA_DIR

try {
    $env:B12_USER_DATA_DIR = $profile
    $env:MILES_DRY_RUN = 'false'
    $env:MILES_CONTROLLED_WRITE_ENABLED = 'true'
    $env:B12_WRITE_ENABLED = 'true'
    $env:B12_PUBLISH_ENABLED = 'false'
    $env:P2GC_B12_APPLY = 'true'
    $env:P2GC_B12_PUBLISH = 'false'
    $env:B12_RESUME_SUCCESSFUL_OPERATIONS = 'true'

    & node $singleSession
    $stageCode = $LASTEXITCODE
} finally {
    foreach ($pair in @(
        @('MILES_DRY_RUN',$oldDry),
        @('MILES_CONTROLLED_WRITE_ENABLED',$oldControlled),
        @('B12_WRITE_ENABLED',$oldWrite),
        @('B12_PUBLISH_ENABLED',$oldPublish),
        @('P2GC_B12_APPLY',$oldApply),
        @('P2GC_B12_PUBLISH',$oldRequestedPublish),
        @('B12_RESUME_SUCCESSFUL_OPERATIONS',$oldResume),
        @('B12_USER_DATA_DIR',$oldProfile)
    )) {
        $name = $pair[0]; $value = $pair[1]
        if ($null -eq $value) { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }
        else { Set-Item "Env:$name" $value }
    }
}

if ($stageCode -ne 0) {
    if (Test-Path $authLatest) {
        Write-Host ''
        Write-Host '=== B12 AUTH / EDITOR OBSERVATION ==='
        $authReport = Get-Content -Raw $authLatest | ConvertFrom-Json
        $authReport | Select-Object status,ok,singleBrowserSession,publicPublishRequested | Format-List
        if ($null -ne $authReport.editorObservation) {
            $authReport.editorObservation | Format-List *
        }
        if ($authReport.screenshot) { Write-Host "SCREENSHOT=$($authReport.screenshot)" }
    }

    if (Test-Path $latest) {
        Write-Host ''
        Write-Host '=== B12 STAGING RESULT ==='
        $failedReport = Get-Content -Raw $latest | ConvertFrom-Json
        $failedReport | Select-Object status,ok,publisherVersion,mutationAttempted,mutationExecuted,publicPublishExecuted | Format-List
        if ($null -ne $failedReport.resume) {
            $failedReport.resume | Format-List *
        }
    }
    Write-Host 'B12_STAGING_NOT_GREEN'
    exit $stageCode
}

if (-not (Test-Path $latest)) {
    Write-Host 'B12_STAGING_NO_REPORT'
    exit 2
}

$report = Get-Content -Raw $latest | ConvertFrom-Json
Write-Host ''
Write-Host '=== B12 STAGING RESULT ==='
$report | Select-Object status,ok,publisherVersion,mutationAttempted,mutationExecuted,publicPublishExecuted | Format-List
if ($null -ne $report.resume) {
    $report.resume | Format-List *
}

if ($report.ok -ne $true -or $report.staging.ok -ne $true -or $report.publicPublishExecuted -eq $true) {
    Write-Host 'B12_STAGING_NOT_GREEN'
    exit 2
}

Write-Host 'B12_AUTH_AND_STAGING_GREEN'
exit 0
