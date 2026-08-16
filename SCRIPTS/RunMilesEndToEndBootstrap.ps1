$ErrorActionPreference = 'Stop'

$Root = 'C:\P2GC_Intelligence\MILES_ENTERPRISE'
$Branch = 'agent/miles-full-system-reconciliation-20260815'
$Repo = 'origin'

Set-Location $Root
Write-Host '=== MILES END-TO-END BOOTSTRAP PREFLIGHT ==='
Write-Host 'Rule: prove machine dependencies before touching production surfaces.'

function Resolve-OrionDb {
  $explicit = @($env:ORION_DB, $env:ORION_DB_PATH) | Where-Object { $_ }
  foreach ($candidate in $explicit) {
    if (Test-Path $candidate -PathType Leaf) { return (Resolve-Path $candidate).Path }
  }

  $parent = Split-Path $Root -Parent
  $direct = @(
    (Join-Path $parent 'Orion Demo 6126\orion_live_demo_ready\ORION_DEMO_LIVE_READY.db'),
    'C:\P2GC_Intelligence\Orion Demo 6126\orion_live_demo_ready\ORION_DEMO_LIVE_READY.db',
    'D:\P2GC_Intelligence\Orion Demo 6126\orion_live_demo_ready\ORION_DEMO_LIVE_READY.db',
    (Join-Path $Root 'DATA\orion\ORION_DEMO_LIVE_READY.db')
  )
  foreach ($candidate in $direct) {
    if ($candidate -and (Test-Path $candidate -PathType Leaf)) { return (Resolve-Path $candidate).Path }
  }

  foreach ($searchRoot in @('C:\P2GC_Intelligence', 'D:\P2GC_Intelligence')) {
    if (-not (Test-Path $searchRoot -PathType Container)) { continue }
    $orionDirs = Get-ChildItem -Path $searchRoot -Directory -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -match 'orion' }
    foreach ($dir in $orionDirs) {
      $match = Get-ChildItem -Path $dir.FullName -Filter 'ORION_DEMO_LIVE_READY.db' -File -Recurse -ErrorAction SilentlyContinue |
        Select-Object -First 1
      if ($match) { return $match.FullName }
    }
  }

  throw 'ORION_DEMO_LIVE_READY.db could not be resolved from ORION_DB/ORION_DB_PATH or the C:/D: P2GC_Intelligence roots.'
}

Write-Host "`n=== PREFLIGHT 1: FETCH CANONICAL BRANCH ==="
git fetch $Repo $Branch | Out-Host
if ($LASTEXITCODE -ne 0) { throw 'Unable to fetch canonical reconciliation branch.' }
$Ref = 'FETCH_HEAD'

Write-Host "`n=== PREFLIGHT 2: PROMOTE TESTED PM2 TRANSPORT ==="
$preflightFiles = @(
  'SCRIPTS/ReconcilePm2Process.js',
  'SCRIPTS/Pm2DirectCommand.js'
)
foreach ($file in $preflightFiles) {
  $target = Join-Path $Root ($file -replace '/', '\\')
  $content = git show "$Ref`:$file"
  if ($LASTEXITCODE -ne 0) { throw "Unable to fetch PM2 preflight file: $file" }
  $content | Set-Content $target -Encoding UTF8
  node --check $target
  if ($LASTEXITCODE -ne 0) { throw "PM2 preflight syntax failed: $file" }
  Write-Host "[PROMOTED] $file"
}

Write-Host "`n=== PREFLIGHT 3: DIRECT PM2 CLI ==="
$pm2Cli = (& node -e "process.stdout.write(require('./SCRIPTS/ReconcilePm2Process').resolvePm2Cli())").Trim()
if ($LASTEXITCODE -ne 0 -or -not $pm2Cli -or -not (Test-Path $pm2Cli -PathType Leaf)) {
  throw "Production PM2 resolver could not find the PM2 JavaScript CLI: $pm2Cli"
}
$env:MILES_PM2_CLI = $pm2Cli
Write-Host "PM2 CLI: $pm2Cli"
node .\SCRIPTS\Pm2DirectCommand.js jlist | Out-Host
if ($LASTEXITCODE -ne 0) { throw 'Direct node.exe -> PM2 JavaScript CLI preflight failed.' }
Write-Host '[PASS] PM2 queried through node.exe without nested cmd.exe.'

Write-Host "`n=== PREFLIGHT 4: ORION DATABASE ==="
$orionDb = Resolve-OrionDb
$env:ORION_DB = $orionDb
$env:ORION_DB_PATH = $orionDb
Write-Host "ORION DB: $orionDb"
Write-Host '[PASS] ORION database path resolved.'

Write-Host "`n=== PREFLIGHT 5: PROMOTE FINAL RUNNER ==="
$finalPath = Join-Path $Root 'SCRIPTS\RunApprovedMilesEndToEndFinal.ps1'
$final = git show "$Ref`:SCRIPTS/RunApprovedMilesEndToEndFinal.ps1"
if ($LASTEXITCODE -ne 0) { throw 'Unable to fetch canonical final runner.' }
$final | Set-Content $finalPath -Encoding UTF8
[void][scriptblock]::Create((Get-Content $finalPath -Raw))
Write-Host "Final runner: $finalPath"

Write-Host "`n=== EXECUTE END-TO-END RECOVERY ==="
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $finalPath
if ($LASTEXITCODE -ne 0) { throw 'MILES_END_TO_END_BOOTSTRAP_FAILED' }

Write-Host ''
Write-Host '=== MILES END-TO-END BOOTSTRAP PASS ==='
Write-Host "PM2 direct CLI : $pm2Cli"
Write-Host "ORION database : $orionDb"
Write-Host 'Final recovery  : PASS'
