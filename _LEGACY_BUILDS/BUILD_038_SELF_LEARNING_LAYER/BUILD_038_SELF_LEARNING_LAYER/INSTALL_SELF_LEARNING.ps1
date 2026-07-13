$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "========================================"
Write-Host " INSTALL BUILD_038 SELF LEARNING LAYER"
Write-Host "========================================"

$Root = "D:\P2GC_Intelligence\MILES_OS"
$BuildRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$Backup = Join-Path $Root "BACKUPS\BUILD_038_$Timestamp"

Write-Host "Root: $Root"
Write-Host "BuildRoot: $BuildRoot"
Write-Host "Backup: $Backup"

New-Item -ItemType Directory -Force -Path $Backup | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Root "SERVICES") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Root "BUILDER") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Root "DATA\self_learning") | Out-Null

$ServiceFiles = @(
    "LearningDataService.js",
    "DecisionLearningService.js",
    "FailureLearningService.js",
    "RoutingLearningService.js",
    "PriorityOptimizationService.js",
    "ConfidenceScoringService.js",
    "RecommendationEngineService.js",
    "SelfLearningService.js"
)

foreach ($File in $ServiceFiles) {
    $Source = Join-Path $BuildRoot "SERVICES\$File"
    $Target = Join-Path $Root "SERVICES\$File"
    if (Test-Path $Target) { Copy-Item $Target (Join-Path $Backup $File) -Force }
    Copy-Item $Source $Target -Force
    Write-Host "Installed SERVICES\$File"
}

$BuilderSource = Join-Path $BuildRoot "BUILDER\BuilderService.js"
$BuilderTarget = Join-Path $Root "BUILDER\BuilderService.js"
if (Test-Path $BuilderTarget) { Copy-Item $BuilderTarget (Join-Path $Backup "BuilderService.js") -Force }
Copy-Item $BuilderSource $BuilderTarget -Force
Write-Host "Installed BUILDER\BuilderService.js"

Copy-Item (Join-Path $BuildRoot "RUN_SELF_LEARNING.ps1") (Join-Path $Root "RUN_SELF_LEARNING.ps1") -Force
Copy-Item (Join-Path $BuildRoot "VERIFY_SELF_LEARNING.ps1") (Join-Path $Root "VERIFY_SELF_LEARNING.ps1") -Force

Write-Host ""
Write-Host "Running BUILD_038 verification..."
Push-Location $Root
try {
    node ".\BUILDER\index.js" SELF_LEARNING
}
finally {
    Pop-Location
}

Write-Host ""
Write-Host "BUILD_038 install complete."
Write-Host "Run: powershell -ExecutionPolicy Bypass -File .\RUN_SELF_LEARNING.ps1"
Write-Host "Verify: powershell -ExecutionPolicy Bypass -File .\VERIFY_SELF_LEARNING.ps1"
