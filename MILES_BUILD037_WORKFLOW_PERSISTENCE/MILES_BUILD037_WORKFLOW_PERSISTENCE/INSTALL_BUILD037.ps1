param(
  [string]$MilesRoot = "D:\P2GC_Intelligence\MILES_ENTERPRISE"
)

$ErrorActionPreference = "Stop"
$PackageRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$BackupRoot = Join-Path $MilesRoot "_BACKUPS\BUILD_037_$Stamp"

Write-Host ""
Write-Host "MILES ENTERPRISE BUILD 037 INSTALLER"
Write-Host "Root: $MilesRoot"
Write-Host "Backup: $BackupRoot"
Write-Host ""

Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force

$Files = @(
  "SERVICES\WorkQueueService.js",
  "SERVICES\AutonomousCOOLoopService.js",
  "TESTS\Test_Build037_WorkflowPersistence.js"
)

foreach ($RelativePath in $Files) {
  $Source = Join-Path $PackageRoot $RelativePath
  $Target = Join-Path $MilesRoot $RelativePath
  $Backup = Join-Path $BackupRoot $RelativePath

  if (-not (Test-Path $Source)) {
    throw "Missing package file: $Source"
  }

  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Target) | Out-Null
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Backup) | Out-Null

  if (Test-Path $Target) {
    Copy-Item $Target $Backup -Force
  }

  Copy-Item $Source $Target -Force
  Write-Host "Installed: $RelativePath"
}

Push-Location $MilesRoot

node --check .\SERVICES\WorkQueueService.js
if ($LASTEXITCODE -ne 0) { throw "WorkQueueService syntax check failed." }

node --check .\SERVICES\AutonomousCOOLoopService.js
if ($LASTEXITCODE -ne 0) { throw "AutonomousCOOLoopService syntax check failed." }

node --check .\TESTS\Test_Build037_WorkflowPersistence.js
if ($LASTEXITCODE -ne 0) { throw "Build 037 test syntax check failed." }

node .\TESTS\Test_Build037_WorkflowPersistence.js
if ($LASTEXITCODE -ne 0) { throw "Build 037 regression test failed." }

Write-Host ""
Write-Host "BUILD 037 INSTALLED AND VALIDATED"
Write-Host "Backup created at: $BackupRoot"
Write-Host ""

Pop-Location
