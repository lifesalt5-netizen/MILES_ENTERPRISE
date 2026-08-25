param(
    [switch]$PlanOnly
)

$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
$env:MILES_ROOT = $Root

Write-Host '============================================================'
Write-Host 'P2GC FULL OPERATIONAL REMEDIATION PACK'
Write-Host '============================================================'
Write-Host 'Rule: sweep and remediate every related subsystem before closeout.'
Write-Host 'IONOS: move-only, no message deletion.'
Write-Host 'Instantly: no email/lead deletion; reconcile CRM interest, reminders, read state, suppression.'
Write-Host 'B12: staging edits only; PUBLIC PUBLISH DISABLED.'
Write-Host ''

if ($PlanOnly) {
    $env:MILES_DRY_RUN = 'true'
    $env:MILES_CONTROLLED_WRITE_ENABLED = 'false'
    $env:MILES_IONOS_MAILBOX_MUTATIONS = 'false'
    $env:MILES_ALLOW_INSTANTLY_MUTATIONS = 'false'
    $env:INSTANTLY_WRITE_ENABLED = 'false'
    node .\RUN_OPERATIONAL_REMEDIATION_ALL.js
    exit $LASTEXITCODE
}

$env:MILES_DRY_RUN = 'false'
$env:MILES_CONTROLLED_WRITE_ENABLED = 'true'
$env:MILES_IONOS_MAILBOX_MUTATIONS = 'true'
$env:MILES_ALLOW_INSTANTLY_MUTATIONS = 'true'
$env:INSTANTLY_WRITE_ENABLED = 'true'

$results = @()

Write-Host '--- CORE CLEANUP: IONOS + INSTANTLY ---'
node .\RUN_OPERATIONAL_REMEDIATION_ALL.js --execute
$coreExit = $LASTEXITCODE
$results += [pscustomobject]@{ Component = 'IONOS_AND_INSTANTLY'; ExitCode = $coreExit; Ok = ($coreExit -eq 0) }

Write-Host ''
Write-Host '--- B12 STAGING REPAIR ---'
$env:P2GC_B12_PUBLISH = 'false'
$env:B12_PUBLISH_ENABLED = 'false'
$env:P2GC_B12_APPLY = 'true'
$env:B12_WRITE_ENABLED = 'true'
$env:B12_RESUME_SUCCESSFUL_OPERATIONS = 'true'
& "$Root\SCRIPTS\B12AuthenticateAndStage.ps1"
$b12Exit = $LASTEXITCODE
$results += [pscustomobject]@{ Component = 'B12_STAGING'; ExitCode = $b12Exit; Ok = ($b12Exit -eq 0) }

Write-Host ''
Write-Host '--- FULL POST-SOAK MASTER SWEEP ---'
& "$Root\SCRIPTS\RunPostSoakMasterAudit.ps1"
$auditExit = $LASTEXITCODE
$results += [pscustomobject]@{ Component = 'POST_SOAK_MASTER_AUDIT'; ExitCode = $auditExit; Ok = ($auditExit -eq 0) }

Write-Host ''
Write-Host '=== COMBINED REMEDIATION RESULT ==='
$results | Format-Table -AutoSize

$failed = @($results | Where-Object { -not $_.Ok })
if ($failed.Count -eq 0) {
    Write-Host 'FULL_OPERATIONAL_REMEDIATION_GREEN'
    exit 0
}

Write-Host 'FULL_OPERATIONAL_REMEDIATION_PARTIAL'
Write-Host 'All lanes were attempted. Remaining failures are evidence for the next grouped repair; no lane was skipped because another failed.'
exit 1
