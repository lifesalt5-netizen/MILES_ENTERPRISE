param(
    [string]$Root = "C:\P2GC_Intelligence\MILES_ENTERPRISE"
)

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path $Root).Path
$env:MILES_ROOT = $Root
Set-Location $Root

$connectorRoot = Join-Path $Root 'CONNECTORS\WEBSITE_B12'
$profile = Join-Path $Root 'DATA\browser_profiles\b12_miles'
$authScript = Join-Path $connectorRoot 'B12_AUTH_BOOTSTRAP.js'
$publisher = Join-Path $connectorRoot 'RUN_CONTROLLED_PUBLISH_V2.ps1'
$latest = Join-Path $Root 'DATA\website_ops\b12_conversion_v2\latest.json'

Write-Host '============================================================'
Write-Host 'P2GC B12 AUTHENTICATE + STAGE'
Write-Host '============================================================'
Write-Host 'This opens a persistent B12 browser profile for YOU to log in.'
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

$oldProfile = $env:B12_USER_DATA_DIR
try {
    $env:B12_USER_DATA_DIR = $profile
    & node $authScript
    $authCode = $LASTEXITCODE
} finally {
    if ($null -eq $oldProfile) { Remove-Item Env:B12_USER_DATA_DIR -ErrorAction SilentlyContinue }
    else { $env:B12_USER_DATA_DIR = $oldProfile }
}

if ($authCode -ne 0) {
    Write-Host 'B12_AUTHENTICATION_NOT_COMPLETE'
    exit $authCode
}

$oldDry = $env:MILES_DRY_RUN
$oldControlled = $env:MILES_CONTROLLED_WRITE_ENABLED
$oldWrite = $env:B12_WRITE_ENABLED
$oldPublish = $env:B12_PUBLISH_ENABLED
$oldProfile = $env:B12_USER_DATA_DIR

try {
    $env:B12_USER_DATA_DIR = $profile
    $env:MILES_DRY_RUN = 'false'
    $env:MILES_CONTROLLED_WRITE_ENABLED = 'true'
    $env:B12_WRITE_ENABLED = 'true'
    $env:B12_PUBLISH_ENABLED = 'false'

    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $publisher -Apply
    $stageCode = $LASTEXITCODE
} finally {
    foreach ($pair in @(
        @('MILES_DRY_RUN',$oldDry),
        @('MILES_CONTROLLED_WRITE_ENABLED',$oldControlled),
        @('B12_WRITE_ENABLED',$oldWrite),
        @('B12_PUBLISH_ENABLED',$oldPublish),
        @('B12_USER_DATA_DIR',$oldProfile)
    )) {
        $name = $pair[0]; $value = $pair[1]
        if ($null -eq $value) { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }
        else { Set-Item "Env:$name" $value }
    }
}

if (-not (Test-Path $latest)) {
    Write-Host 'B12_STAGING_NO_REPORT'
    exit 2
}

$report = Get-Content -Raw $latest | ConvertFrom-Json
Write-Host ''
Write-Host '=== B12 STAGING RESULT ==='
$report | Select-Object status,ok,mutationExecuted,publicPublishExecuted | Format-List

if ($stageCode -ne 0 -or $report.ok -ne $true -or $report.staging.ok -ne $true -or $report.publicPublishExecuted -eq $true) {
    Write-Host 'B12_STAGING_NOT_GREEN'
    exit 2
}

Write-Host 'B12_AUTH_AND_STAGING_GREEN'
exit 0
