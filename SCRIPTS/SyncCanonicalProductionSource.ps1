param(
  [string]$SourceRoot = 'C:\P2GC_Intelligence\MILES_ENTERPRISE',
  [string]$DestinationRoot = 'C:\P2GC_Intelligence\MILES_ENTERPRISE',
  [string]$Ref = 'FETCH_HEAD'
)

$ErrorActionPreference = 'Stop'

$SourceRoot = [IO.Path]::GetFullPath($SourceRoot)
$DestinationRoot = [IO.Path]::GetFullPath($DestinationRoot)
if (-not (Test-Path $SourceRoot -PathType Container)) { throw "Source repo missing: $SourceRoot" }
New-Item -ItemType Directory -Force -Path $DestinationRoot | Out-Null

$actual = (& git -C $SourceRoot rev-parse $Ref).Trim()
if ($LASTEXITCODE -ne 0 -or -not $actual) { throw "Unable to resolve canonical ref: $Ref" }

$topLevel = @(& git -C $SourceRoot ls-tree --name-only $Ref)
if ($LASTEXITCODE -ne 0 -or $topLevel.Count -eq 0) { throw "Unable to enumerate canonical tree: $Ref" }

$excludedTop = @('DATA', 'logs', 'node_modules', '.git', '.github')
$archivePaths = @($topLevel | Where-Object {
  $_ -and ($excludedTop -notcontains $_) -and ($_ -notmatch '^\.env($|\.)')
})
if ($archivePaths.Count -eq 0) { throw 'Canonical source archive resolved zero deployable paths.' }

$tempRoot = Join-Path ([IO.Path]::GetTempPath()) ("miles_canonical_sync_" + [guid]::NewGuid().ToString('N'))
$zip = Join-Path $tempRoot 'canonical.zip'
$extract = Join-Path $tempRoot 'extract'
New-Item -ItemType Directory -Force -Path $tempRoot, $extract | Out-Null

try {
  & git -C $SourceRoot archive --format=zip --output=$zip $Ref -- @archivePaths
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $zip -PathType Leaf)) { throw 'git archive failed for canonical production source.' }

  Expand-Archive -Path $zip -DestinationPath $extract -Force

  $files = @(Get-ChildItem -Path $extract -File -Recurse)
  if ($files.Count -lt 25) { throw "Canonical source archive unexpectedly small: $($files.Count) files" }

  $copied = 0
  foreach ($file in $files) {
    $relative = [IO.Path]::GetRelativePath($extract, $file.FullName)
    if ($relative -match '(^|[\\/])\.env($|\.)') { continue }
    if ($relative -match '^(DATA|logs|node_modules|\.git|\.github)[\\/]') { continue }

    $target = Join-Path $DestinationRoot $relative
    $targetDir = Split-Path $target -Parent
    if ($targetDir) { New-Item -ItemType Directory -Force -Path $targetDir | Out-Null }
    Copy-Item -LiteralPath $file.FullName -Destination $target -Force
    $copied += 1
  }

  $critical = @(
    'CORE\TaskQueue.js',
    'SERVICES\BusinessOperationsBridgeService.js',
    'SERVICES\revenue\RevenueTruthGateService.js',
    'SERVICES\digital_coo\MilesCommandCenter.js',
    'SCRIPTS\TestP2GCWholeSystemAcceptanceP0.js',
    'CONFIG\PRODUCTION_SYSTEM_GRAPH.json',
    'SCRIPTS\TestProductionDependencyGraphP0.js'
  )
  $missing = @($critical | Where-Object { -not (Test-Path (Join-Path $DestinationRoot $_) -PathType Leaf) })
  if ($missing.Count -gt 0) { throw "Canonical source sync incomplete. Missing: $($missing -join ', ')" }

  $stateDir = Join-Path $DestinationRoot 'DATA\runtime_guardian'
  New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
  $report = [ordered]@{
    ok = $true
    ref = $Ref
    commit = $actual
    copiedFiles = $copied
    protectedRuntimeState = @('DATA', 'logs', '.env', 'node_modules', '.git')
    completedAt = (Get-Date).ToUniversalTime().ToString('o')
  }
  $report | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $stateDir 'canonical_source_sync_latest.json') -Encoding UTF8
  Write-Host ("[CANONICAL SOURCE SYNC PASS] commit={0} files={1}" -f $actual, $copied)
} finally {
  Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
}
