param(
    [string]$Root = "C:\P2GC_Intelligence\MILES_ENTERPRISE"
)

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path $Root).Path
$env:MILES_ROOT = $Root
Set-Location $Root

$runner = Join-Path $Root 'RUN_P2GC_DUE_NURTURE_CLOSEOUT.js'
$latest = Join-Path $Root 'DATA\runtime\revenue\nurture\closeout_latest.json'

Write-Host '============================================================'
Write-Host 'P2GC DUE NURTURE CLOSEOUT'
Write-Host '============================================================'
Write-Host 'Step 1 is PLAN ONLY. No message is sent until you explicitly type SEND.'
Write-Host ''

$oldDry = $env:MILES_DRY_RUN
$oldMutations = $env:MILES_ALLOW_INSTANTLY_MUTATIONS
$oldControlled = $env:MILES_CONTROLLED_WRITE_ENABLED
$oldInstantlyWrite = $env:INSTANTLY_WRITE_ENABLED
$oldApproval = $env:P2GC_NURTURE_CLOSEOUT_APPROVAL
$oldApprovedIds = $env:P2GC_NURTURE_APPROVED_IDS

try {
    $env:MILES_DRY_RUN = 'true'
    $env:MILES_ALLOW_INSTANTLY_MUTATIONS = 'false'
    $env:MILES_CONTROLLED_WRITE_ENABLED = 'false'
    $env:INSTANTLY_WRITE_ENABLED = 'false'
    Remove-Item Env:P2GC_NURTURE_CLOSEOUT_APPROVAL -ErrorAction SilentlyContinue
    Remove-Item Env:P2GC_NURTURE_APPROVED_IDS -ErrorAction SilentlyContinue

    & node $runner
    $planCode = $LASTEXITCODE

    if ($planCode -ne 0 -or -not (Test-Path $latest)) {
        Write-Host 'NURTURE_PLAN_NOT_GREEN'
        exit 2
    }

    $plan = Get-Content -Raw $latest | ConvertFrom-Json

    Write-Host ''
    Write-Host '=== CURRENT DUE GOVERNED NURTURE ACTIONS ==='
    $plan.queue |
        Select-Object id,category,contactEmail,eaccount,dueAt,subject |
        Format-Table -Auto

    Write-Host ''
    foreach ($item in @($plan.queue)) {
        Write-Host ('TO: ' + $item.contactEmail)
        Write-Host ('FROM: ' + $item.eaccount)
        Write-Host ('SUBJECT: ' + $item.subject)
        Write-Host ('BODY: ' + $item.body.text)
        Write-Host '---'
    }

    if ([int]$plan.queueCount -eq 0) {
        Write-Host 'NO_DUE_NURTURE_ACTIONS'
        exit 0
    }

    $answer = Read-Host "Type SEND to send exactly these $($plan.queueCount) currently-due governed replies"
    if ($answer -cne 'SEND') {
        Write-Host 'NURTURE_SEND_NOT_APPROVED'
        exit 3
    }

    $approvedIds = @($plan.operationIds) -join ','
    $env:P2GC_NURTURE_APPROVED_IDS = $approvedIds
    $env:P2GC_NURTURE_CLOSEOUT_APPROVAL = 'SEND_DUE_NURTURE'
    $env:MILES_DRY_RUN = 'false'
    $env:MILES_ALLOW_INSTANTLY_MUTATIONS = 'true'
    $env:MILES_CONTROLLED_WRITE_ENABLED = 'true'
    $env:INSTANTLY_WRITE_ENABLED = 'true'

    Write-Host ''
    Write-Host '=== EXECUTING EXACT APPROVED NURTURE SET ==='
    & node $runner --execute
    $executeCode = $LASTEXITCODE

    if ($executeCode -ne 0 -or -not (Test-Path $latest)) {
        Write-Host 'DUE_NURTURE_EXECUTION_NOT_GREEN'
        exit 2
    }

    $result = Get-Content -Raw $latest | ConvertFrom-Json
    $result | Select-Object status,ok,queueCount | Format-List
    $result.execution | Select-Object status,attempted,executed,dryRunOrBlocked | Format-List

    if ($result.ok -ne $true -or [string]$result.status -ne 'DUE_NURTURE_EXECUTION_GREEN') {
        Write-Host 'DUE_NURTURE_EXECUTION_NOT_GREEN'
        exit 2
    }

    Write-Host 'DUE_NURTURE_EXECUTION_GREEN'
    exit 0
}
finally {
    foreach ($pair in @(
        @('MILES_DRY_RUN',$oldDry),
        @('MILES_ALLOW_INSTANTLY_MUTATIONS',$oldMutations),
        @('MILES_CONTROLLED_WRITE_ENABLED',$oldControlled),
        @('INSTANTLY_WRITE_ENABLED',$oldInstantlyWrite),
        @('P2GC_NURTURE_CLOSEOUT_APPROVAL',$oldApproval),
        @('P2GC_NURTURE_APPROVED_IDS',$oldApprovedIds)
    )) {
        $name = $pair[0]; $value = $pair[1]
        if ($null -eq $value) { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }
        else { Set-Item "Env:$name" $value }
    }
}
