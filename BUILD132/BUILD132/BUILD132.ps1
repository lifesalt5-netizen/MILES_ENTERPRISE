#requires -version 5.1
[CmdletBinding()]
param(
    [string]$MilesRoot = "D:\P2GC_Intelligence\MILES_ENTERPRISE"
)

$ErrorActionPreference = "Stop"
$BuildRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "BUILD132 INSTALL START"
Write-Host "ROOT: $MilesRoot"

if (-not (Test-Path $MilesRoot)) {
    throw "MILES root not found: $MilesRoot"
}

& node (Join-Path $BuildRoot "Tests\Build132.test.js")
if ($LASTEXITCODE -ne 0) { throw "BUILD132 package tests failed." }

& node (Join-Path $BuildRoot "Patch.js") $MilesRoot
if ($LASTEXITCODE -ne 0) { throw "BUILD132 patch failed." }

& node (Join-Path $BuildRoot "Validation\Validate.js") $MilesRoot
if ($LASTEXITCODE -ne 0) { throw "BUILD132 validation failed." }

Write-Host "BUILD132 COMPLETE"
Write-Host "STATUS: PASSED"
