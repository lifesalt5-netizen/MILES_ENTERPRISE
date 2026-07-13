$ErrorActionPreference = "Stop"
$Root = $env:MILES_ROOT
if ([string]::IsNullOrWhiteSpace($Root)) { $Root = "D:\P2GC_Intelligence\MILES_OS" }
$BuildRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$Backup = Join-Path $Root "BACKUPS\EXEC_004_$Stamp"

Write-Host ""
Write-Host "========================================"
Write-Host " INSTALL EXEC_004 CONTROLLED WRITE MODE"
Write-Host "========================================"
Write-Host "Root: $Root"
Write-Host "BuildRoot: $BuildRoot"
Write-Host "Backup: $Backup"

New-Item -ItemType Directory -Force -Path $Backup | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Root "SERVICES") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Root "BUILDER") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Root "DATA\controlled_write") | Out-Null

$Files = @(
  @{Src="SERVICES\ControlledWritePolicyService.js"; Dst="SERVICES\ControlledWritePolicyService.js"},
  @{Src="SERVICES\ControlledWriteAuditService.js"; Dst="SERVICES\ControlledWriteAuditService.js"},
  @{Src="SERVICES\InstantlyControlledWriteService.js"; Dst="SERVICES\InstantlyControlledWriteService.js"},
  @{Src="SERVICES\ControlledWriteService.js"; Dst="SERVICES\ControlledWriteService.js"},
  @{Src="BUILDER\BuilderService.js"; Dst="BUILDER\BuilderService.js"}
)

foreach ($File in $Files) {
  $Source = Join-Path $BuildRoot $File.Src
  $Dest = Join-Path $Root $File.Dst
  if (Test-Path $Dest) {
    $BackupDest = Join-Path $Backup $File.Dst
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $BackupDest) | Out-Null
    Copy-Item $Dest $BackupDest -Force
  }
  Copy-Item $Source $Dest -Force
  Write-Host "Installed $($File.Dst)"
}

Write-Host ""
Write-Host "Running EXEC_004 verification..."
powershell -ExecutionPolicy Bypass -File (Join-Path $BuildRoot "VERIFY_CONTROLLED_WRITE.ps1")
Write-Host ""
Write-Host "EXEC_004 install complete."
Write-Host "Dry run: powershell -ExecutionPolicy Bypass -File .\RUN_CONTROLLED_WRITE_DRY_RUN.ps1"
Write-Host "Policy: powershell -ExecutionPolicy Bypass -File .\RUN_CONTROLLED_WRITE_POLICY.ps1"
Write-Host "Live test writes require MILES_CONTROLLED_WRITE_ENABLED=true and INSTANTLY_WRITE_ENABLED=true."
