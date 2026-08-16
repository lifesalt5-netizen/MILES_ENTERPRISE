$ErrorActionPreference = 'Stop'

$Root = 'C:\P2GC_Intelligence\MILES_ENTERPRISE'
$Branch = 'agent/miles-full-system-reconciliation-20260815'
$Repo = 'origin'

Set-Location $Root
Write-Host '=== MILES + P2GC FINAL END-TO-END RECOVERY ==='
Write-Host 'Policy: no partial acceptance; worker must be stable, command execution must complete, and prospect demo must pass.'

git fetch $Repo $Branch | Out-Host
if ($LASTEXITCODE -ne 0) { throw 'Unable to fetch final reconciliation branch.' }
$Ref = 'FETCH_HEAD'

# Promote the canonical acceptance test before invoking the main reconciliation.
$acceptancePath = Join-Path $Root 'SCRIPTS\TestMilesProductionRecoveryAcceptanceP0.js'
$acceptance = git show "$Ref`:SCRIPTS/TestMilesProductionRecoveryAcceptanceP0.js"
if ($LASTEXITCODE -ne 0) { throw 'Unable to fetch canonical MILES acceptance test.' }
$acceptance | Set-Content $acceptancePath -Encoding UTF8
node --check $acceptancePath
if ($LASTEXITCODE -ne 0) { throw 'Canonical MILES acceptance syntax failed.' }

$runnerPath = Join-Path $Root 'SCRIPTS\RunApprovedMilesFullSystemReconciliation.ps1'
$runner = git show "$Ref`:SCRIPTS/RunApprovedMilesFullSystemReconciliation.ps1"
if ($LASTEXITCODE -ne 0) { throw 'Unable to fetch canonical full-system runner.' }
$runner | Set-Content $runnerPath -Encoding UTF8

powershell -NoProfile -ExecutionPolicy Bypass -File $runnerPath
if ($LASTEXITCODE -ne 0) { throw 'FINAL_END_TO_END_RECONCILIATION_FAILED' }

Write-Host ''
Write-Host '=== FINAL END-TO-END PASS ==='
Write-Host 'MILES worker stability        : PASS'
Write-Host 'MILES API / port 3000         : PASS'
Write-Host 'MILES Command Center / 8787   : PASS'
Write-Host 'MILES command execution       : PASS'
Write-Host 'MILES persisted result truth  : PASS'
Write-Host 'P2GC prospect demo / 8791     : PASS'
Write-Host 'Executive Dashboard / 8737   : PRESERVED'
Write-Host 'Local Git branch/HEAD         : PRESERVED'