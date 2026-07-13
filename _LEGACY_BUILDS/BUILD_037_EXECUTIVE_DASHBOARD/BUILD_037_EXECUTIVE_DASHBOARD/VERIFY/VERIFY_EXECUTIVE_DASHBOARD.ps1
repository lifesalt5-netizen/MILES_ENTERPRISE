param(
    [string]$Root = "D:\P2GC_Intelligence\MILES_OS"
)

$ErrorActionPreference = "Stop"
Write-Host ""
Write-Host "========================================"
Write-Host " VERIFY BUILD_037 EXECUTIVE DASHBOARD"
Write-Host "========================================"
Write-Host "Root: $Root"

$Required = @(
    "SERVICES\DashboardDataService.js",
    "SERVICES\ExecutiveDashboardService.js",
    "SERVICES\DashboardServerService.js",
    "BUILDER\BuilderService.js"
)

$Missing = @()
foreach ($Rel in $Required) {
    $Full = Join-Path $Root $Rel
    if (!(Test-Path $Full)) {
        $Missing += $Rel
    }
}

if ($Missing.Count -gt 0) {
    throw "Missing required files: $($Missing -join ', ')"
}

Push-Location $Root
try {
    node --check .\SERVICES\DashboardDataService.js
    node --check .\SERVICES\ExecutiveDashboardService.js
    node --check .\SERVICES\DashboardServerService.js
    node --check .\BUILDER\BuilderService.js
    $Output = node .\BUILDER\index.js EXECUTIVE_DASHBOARD | Out-String
}
finally {
    Pop-Location
}

$State = Join-Path $Root "DATA\executive_dashboard\dashboard_state.json"
$Summary = Join-Path $Root "DATA\executive_dashboard\dashboard_summary.json"
$Alerts = Join-Path $Root "DATA\executive_dashboard\dashboard_alerts.json"
$Html = Join-Path $Root "DATA\executive_dashboard\index.html"

$GeneratedMissing = @()
foreach ($File in @($State, $Summary, $Alerts, $Html)) {
    if (!(Test-Path $File)) { $GeneratedMissing += $File }
}

if ($GeneratedMissing.Count -gt 0) {
    throw "Dashboard did not generate required outputs: $($GeneratedMissing -join ', ')"
}

$Result = [ordered]@{
    ok = $true
    action = "VERIFY_EXECUTIVE_DASHBOARD"
    generatedAt = (Get-Date).ToUniversalTime().ToString("o")
    root = $Root
    requiredFiles = $Required.Count
    missing = $Missing
    outputs = @{
        state = $State
        summary = $Summary
        alerts = $Alerts
        html = $Html
    }
}

$Result | ConvertTo-Json -Depth 8
