$ErrorActionPreference = "Stop"
$Root = "D:\P2GC_Intelligence\MILES_OS"
$Patch = Split-Path -Parent $MyInvocation.MyCommand.Path
$Stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$Backup = Join-Path $Root "BACKUPS\build005_$Stamp"
Write-Host "MILES Build 005: Executive Operations Layer" -ForegroundColor Cyan
if (!(Test-Path $Root)) { throw "MILES root not found: $Root" }
New-Item -ItemType Directory -Force -Path $Backup | Out-Null
$items = @("StartMiles.js","package.json","WEB","TESTS","DOCS","DATA\ceo_approvals.json","DATA\ai_workforce_master.json","DATA\development_center.json")
foreach ($item in $items) {
  $src = Join-Path $Root $item
  if (Test-Path $src) {
    $dest = Join-Path $Backup $item
    New-Item -ItemType Directory -Force -Path (Split-Path $dest -Parent) | Out-Null
    Copy-Item $src $dest -Recurse -Force
  }
}
foreach ($dir in @("WEB","TESTS","DOCS","DATA","CONFIG","SERVICES")) { New-Item -ItemType Directory -Force -Path (Join-Path $Root $dir) | Out-Null }
Copy-Item (Join-Path $Patch "StartMiles.js") (Join-Path $Root "StartMiles.js") -Force
Copy-Item (Join-Path $Patch "package.json") (Join-Path $Root "package.json") -Force
Copy-Item (Join-Path $Patch "WEB\*") (Join-Path $Root "WEB") -Recurse -Force
Copy-Item (Join-Path $Patch "TESTS\*") (Join-Path $Root "TESTS") -Recurse -Force
Copy-Item (Join-Path $Patch "DOCS\*") (Join-Path $Root "DOCS") -Recurse -Force
Set-Location $Root
npm install
npm test
Write-Host "BUILD 005 COMPLETE. Backup: $Backup" -ForegroundColor Green
Write-Host "Run: npm start" -ForegroundColor Yellow
Write-Host "Open: http://localhost:3737" -ForegroundColor Yellow
