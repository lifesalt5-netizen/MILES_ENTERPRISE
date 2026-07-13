$ErrorActionPreference = "Stop"
Write-Host "MILES Build 006: Outbound Operations Department" -ForegroundColor Cyan
$root = "D:\P2GC_Intelligence\MILES_OS"
if (!(Test-Path $root)) { throw "MILES root not found: $root" }
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backup = Join-Path $root "BACKUPS\build006_$stamp"
New-Item -ItemType Directory -Force -Path $backup | Out-Null
$items = @("StartMiles.js","package.json","WEB","SERVICES","DATA","CONFIG","TESTS")
foreach ($item in $items) {
  $src = Join-Path $root $item
  if (Test-Path $src) { Copy-Item $src -Destination $backup -Recurse -Force }
}
Copy-Item -Path (Join-Path $PSScriptRoot "payload\*") -Destination $root -Recurse -Force
Set-Location $root
npm install
npm test
Write-Host "BUILD 006 COMPLETE. Backup: $backup" -ForegroundColor Green
Write-Host "Run from D:\P2GC_Intelligence\MILES_OS : npm start" -ForegroundColor Yellow
Write-Host "Open: http://localhost:3737" -ForegroundColor Yellow
