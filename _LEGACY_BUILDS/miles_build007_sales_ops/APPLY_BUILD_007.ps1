$ErrorActionPreference = 'Stop'
Write-Host "MILES Build 007: Sales Operations Department"
$Root = "D:\P2GC_Intelligence\MILES_OS"
if (!(Test-Path $Root)) { throw "MILES root not found: $Root" }
$Stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$Backup = Join-Path $Root "BACKUPS\build007_sales_$Stamp"
New-Item -ItemType Directory -Force -Path $Backup | Out-Null
$items = @("SERVICES","WEB","DATA","TESTS","package.json")
foreach ($i in $items) { $p = Join-Path $Root $i; if (Test-Path $p) { Copy-Item $p $Backup -Recurse -Force } }
Copy-Item ".\BUILD_007\*" $Root -Recurse -Force
# Patch package.json scripts safely
$pkgPath = Join-Path $Root "package.json"
if (Test-Path $pkgPath) {
  $pkg = Get-Content $pkgPath -Raw | ConvertFrom-Json
  if (-not $pkg.scripts) { $pkg | Add-Member -MemberType NoteProperty -Name scripts -Value ([pscustomobject]@{}) }
  $pkg.scripts | Add-Member -Force -MemberType NoteProperty -Name "sales:audit" -Value "node TESTS/sales_healthcheck.js"
  $pkg.scripts | Add-Member -Force -MemberType NoteProperty -Name "build007:test" -Value "node TESTS/sales_healthcheck.js"
  $pkg.version = "0.1.0-build007"
  $pkg | ConvertTo-Json -Depth 20 | Set-Content $pkgPath -Encoding UTF8
}
Push-Location $Root
npm run build007:test
Pop-Location
Write-Host "BUILD 007 COMPLETE. Backup: $Backup"
Write-Host "Run from $Root : npm start"
Write-Host "Open: http://localhost:3737"
Write-Host "Sales page file: WEB\desktop\sales.html"
