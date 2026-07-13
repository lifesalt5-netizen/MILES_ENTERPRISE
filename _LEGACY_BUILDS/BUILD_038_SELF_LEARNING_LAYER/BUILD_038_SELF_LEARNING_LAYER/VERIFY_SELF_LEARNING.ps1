$ErrorActionPreference = "Stop"
$Root = "D:\P2GC_Intelligence\MILES_OS"
Write-Host ""
Write-Host "========================================"
Write-Host " VERIFY BUILD_038 SELF LEARNING"
Write-Host "========================================"
Write-Host "Root: $Root"

$Required = @(
    "SERVICES\LearningDataService.js",
    "SERVICES\DecisionLearningService.js",
    "SERVICES\FailureLearningService.js",
    "SERVICES\RoutingLearningService.js",
    "SERVICES\PriorityOptimizationService.js",
    "SERVICES\ConfidenceScoringService.js",
    "SERVICES\RecommendationEngineService.js",
    "SERVICES\SelfLearningService.js",
    "BUILDER\BuilderService.js"
)

$Missing = @()
foreach ($File in $Required) {
    $Path = Join-Path $Root $File
    if (!(Test-Path $Path)) { $Missing += $File }
}

if ($Missing.Count -gt 0) {
    Write-Host "Missing files:" -ForegroundColor Red
    $Missing | ForEach-Object { Write-Host " - $_" -ForegroundColor Red }
    throw "BUILD_038 verification failed: missing required files."
}

Push-Location $Root
try {
    $Output = node ".\BUILDER\index.js" SELF_LEARNING
    Write-Host $Output
    $Latest = Join-Path $Root "DATA\self_learning\latest_learning_state.json"
    $Report = Join-Path $Root "DATA\self_learning\self_learning_report.md"
    if (!(Test-Path $Latest)) { throw "Missing latest_learning_state.json" }
    if (!(Test-Path $Report)) { throw "Missing self_learning_report.md" }
}
finally { Pop-Location }

Write-Host ""
Write-Host "BUILD_038 verification passed."
