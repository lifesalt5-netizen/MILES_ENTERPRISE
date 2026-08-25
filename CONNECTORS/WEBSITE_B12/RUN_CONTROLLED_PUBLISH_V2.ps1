param(
    [switch]$Apply,
    [switch]$Publish
)

$ErrorActionPreference = 'Stop'
$ConnectorRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$MilesRoot = Resolve-Path (Join-Path $ConnectorRoot '..\..')
$Publisher = Join-Path $ConnectorRoot 'B12_CONTROLLED_PUBLISHER_V3.js'
$Profile = Join-Path $MilesRoot 'DATA\browser_profiles\b12_miles'

if (-not $env:MILES_ROOT) { $env:MILES_ROOT = $MilesRoot.Path }
if (-not $env:B12_USER_DATA_DIR -and -not $env:B12_CDP_URL) { $env:B12_USER_DATA_DIR = $Profile }
$env:P2GC_B12_APPLY = if ($Apply) { 'true' } else { 'false' }
$env:P2GC_B12_PUBLISH = if ($Publish) { 'true' } else { 'false' }

Write-Host 'P2GC B12 Controlled Publisher V3 (frame-aware B12 3.0 editor)'
Write-Host "MILES_ROOT: $($env:MILES_ROOT)"
Write-Host "Apply requested: $Apply"
Write-Host "Publish requested: $Publish"
Write-Host "MILES_DRY_RUN: $($env:MILES_DRY_RUN)"
Write-Host "MILES_CONTROLLED_WRITE_ENABLED: $($env:MILES_CONTROLLED_WRITE_ENABLED)"
Write-Host "B12_WRITE_ENABLED: $($env:B12_WRITE_ENABLED)"
Write-Host "B12_PUBLISH_ENABLED: $($env:B12_PUBLISH_ENABLED)"

if (-not (Test-Path (Join-Path $ConnectorRoot 'node_modules\playwright'))) {
    Write-Host 'B12 connector dependencies are not installed in this checkout.'
    Write-Host "Run: cd `"$ConnectorRoot`"; npm install"
    exit 2
}

node $Publisher
exit $LASTEXITCODE
