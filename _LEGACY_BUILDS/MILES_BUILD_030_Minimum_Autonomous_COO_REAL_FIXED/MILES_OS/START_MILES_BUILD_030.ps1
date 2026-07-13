param(
    [switch]$Once,
    [switch]$Execute,
    [switch]$Show,
    [int]$IntervalSeconds = 300
)

$ErrorActionPreference = "Stop"
$Root = "D:\P2GC_Intelligence\MILES_OS"
Set-Location $Root

Write-Host "========================================" -ForegroundColor Cyan
Write-Host " MILES BUILD 030 - MINIMUM AUTONOMOUS COO" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Root: $Root"
Write-Host "Once: $Once Execute: $Execute Show: $Show IntervalSeconds: $IntervalSeconds"
Write-Host ""

$argsList = @(".\TESTS\Test_Build030_MinimumAutonomousCOO.js")
if ($Execute) { $argsList += "--execute" }
if ($Show) { $argsList += "--headed" }

if ($Once) {
    node @argsList
    exit $LASTEXITCODE
}

while ($true) {
    $stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Write-Host "[$stamp] Running MILES COO cycle..." -ForegroundColor Green
    node @argsList
    Write-Host "[$stamp] Cycle complete. Sleeping $IntervalSeconds seconds..." -ForegroundColor DarkGray
    Start-Sleep -Seconds $IntervalSeconds
}
