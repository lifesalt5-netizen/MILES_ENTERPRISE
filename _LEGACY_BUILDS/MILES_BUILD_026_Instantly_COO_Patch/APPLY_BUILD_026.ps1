$ErrorActionPreference = "Stop"
$Root = "D:\P2GC_Intelligence\MILES_OS"
$PatchRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Backup = "D:\P2GC_Intelligence\MILES_OS_BACKUP_BUILD026_$(Get-Date -Format yyyyMMdd_HHmmss)"

Write-Host "Creating backup: $Backup"
Copy-Item $Root $Backup -Recurse -Force

Write-Host "Applying Build 026 Instantly COO patch..."
Copy-Item "$PatchRoot\MILES_OS\SERVICES\Browser\Workers\InstantlyCampaignOperator.js" "$Root\SERVICES\Browser\Workers\InstantlyCampaignOperator.js" -Force
Copy-Item "$PatchRoot\MILES_OS\TESTS\Test_InstantlyCampaignOperator.js" "$Root\TESTS\Test_InstantlyCampaignOperator.js" -Force

Write-Host "Syntax check..."
Push-Location $Root
node -c .\SERVICES\Browser\Workers\InstantlyCampaignOperator.js
node -c .\TESTS\Test_InstantlyCampaignOperator.js
Pop-Location

Write-Host "Build 026 patch applied."
Write-Host "Run observe mode: cd $Root; node .\TESTS\Test_InstantlyCampaignOperator.js"
Write-Host "Run execute mode: cd $Root; node .\TESTS\Test_InstantlyCampaignOperator.js --execute"
