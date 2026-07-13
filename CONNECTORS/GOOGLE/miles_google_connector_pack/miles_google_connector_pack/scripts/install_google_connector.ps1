param(
    [string]$RepoRoot = "D:\P2GC_Intelligence\MILES_OS\MILES_OS_v1"
)

$Source = Join-Path $PSScriptRoot "..\CONNECTORS\GOOGLE"
$Target = Join-Path $RepoRoot "CONNECTORS\GOOGLE"

if (!(Test-Path $Target)) {
    New-Item -ItemType Directory -Path $Target -Force | Out-Null
}

Copy-Item -Path (Join-Path $Source "*") -Destination $Target -Recurse -Force
Write-Host "Google connector installed to $Target"
Write-Host "Next: node CONNECTORS/GOOGLE/auth.js"
