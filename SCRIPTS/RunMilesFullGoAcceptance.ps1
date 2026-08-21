param(
    [string]$Root = "C:\P2GC_Intelligence\MILES_ENTERPRISE",
    [string]$IntelligenceRoot = "D:\P2GC_Intelligence",
    [int]$CreditLimit = 100,
    [switch]$AuthorizePaidVerification,
    [switch]$PlanOnly,
    [switch]$SkipGitFetch
)

$ErrorActionPreference = "Stop"

function Invoke-External {
    param([string]$FilePath,[string[]]$Arguments,[string]$WorkingDirectory)
    $old = $ErrorActionPreference
    try {
        $ErrorActionPreference = "Continue"
        Push-Location $WorkingDirectory
        try {
            $output = & $FilePath @Arguments 2>&1 | ForEach-Object { [string]$_ }
            $code = $LASTEXITCODE
        } finally { Pop-Location }
    } finally { $ErrorActionPreference = $old }
    return [pscustomobject]@{ exitCode=$code; output=@($output) }
}

function Read-EnvMap([string]$Path) {
    $map = @{}
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $map }
    foreach ($line in Get-Content -LiteralPath $Path) {
        $text = [string]$line
        if (-not $text) { continue }
        $text = $text.Trim()
        if (-not $text -or $text.StartsWith('#')) { continue }
        if ($text -match '^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
            $value = [string]$Matches[2]
            if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
                $value = $value.Substring(1, [Math]::Max(0, $value.Length - 2))
            }
            $map[$Matches[1].ToUpperInvariant()] = $value
        }
    }
    return $map
}

function Env-Bool($Map,[string]$Name,[bool]$Fallback=$false) {
    $key = $Name.ToUpperInvariant()
    if (-not $Map.ContainsKey($key)) { return $Fallback }
    $v = ([string]$Map[$key]).Trim().ToLowerInvariant()
    if (@('1','true','yes','y','on') -contains $v) { return $true }
    if (@('0','false','no','n','off') -contains $v) { return $false }
    return $Fallback
}

function Read-JsonSafe([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    try { return Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json } catch { return $null }
}

function Add-Check([System.Collections.ArrayList]$List,[string]$Name,[bool]$Passed,[string]$Detail,[bool]$Hard=$true) {
    [void]$List.Add([pscustomobject]@{ name=$Name; passed=$Passed; hard=$Hard; detail=$Detail })
}

$plan = [ordered]@{
    audit = 'MILES_FULL_GO_PRODUCTION_ACCEPTANCE'
    mode = if($PlanOnly){'PLAN_ONLY'}else{'EXECUTE'}
    root = $Root
    intelligenceRoot = $IntelligenceRoot
    creditLimit = $CreditLimit
    paidVerificationAuthorized = [bool]$AuthorizePaidVerification
    requiredSequence = @(
        'CURRENT_MAIN_CODE',
        'LIVE_RUNTIME_AND_DASHBOARD',
        'LIVE_INSTANTLY_READ_CONNECTIVITY',
        'CONTROLLED_WRITE_GATES',
        'GMAIL_EXECUTIVE_TRIAGE_GATES',
        'GMAIL_LEGACY_FORWARDING_DISABLED_AND_READABLE',
        'AUTONOMOUS_REVENUE_CONTROL_PLANE',
        'OUTBOUND_GOVERNANCE',
        'REPLY_AND_REPLACEMENT_RECOVERY',
        'CRM_AND_CALENDLY',
        'TRUTH_RECOVERED_CONTACT_INTAKE',
        'TRUTH_RECOVERED_EMAIL_VERIFICATION_IF_PENDING',
        'LEAD_SUPPLY_CHAIN_CLOSEOUT',
        'FULL_GO_DECISION'
    )
    safety = [ordered]@{
        noPaidVerificationWithoutExplicitSwitch = $true
        noInstantlyMutationFromAcceptanceRunner = $true
        noCampaignActivationFromAcceptanceRunner = $true
        noEmailSendFromAcceptanceRunner = $true
        gmailTriageAcceptanceIsPlanOnly = $true
        secretsPrinted = $false
    }
}

if ($PlanOnly) {
    $plan | ConvertTo-Json -Depth 8
    exit 0
}

if (-not (Test-Path -LiteralPath $Root -PathType Container)) { throw "MILES root not found: $Root" }
if (-not (Test-Path -LiteralPath (Join-Path $Root '.git'))) { throw "MILES root is not a Git working copy: $Root" }
if ($CreditLimit -le 0 -or $CreditLimit -gt 500) { throw 'CreditLimit must be between 1 and 500.' }

$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$outDir = Join-Path $Root "DATA\operational_acceptance\FULL_GO_$stamp"
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
$checks = New-Object System.Collections.ArrayList

# 1. Current production code truth.
if (-not $SkipGitFetch) {
    $fetch = Invoke-External -FilePath 'git' -Arguments @('fetch','--quiet','origin','main') -WorkingDirectory $Root
    Add-Check $checks 'GIT_FETCH_MAIN' ($fetch.exitCode -eq 0) "exit=$($fetch.exitCode)" $true
}
$head = Invoke-External -FilePath 'git' -Arguments @('rev-parse','HEAD') -WorkingDirectory $Root
$origin = Invoke-External -FilePath 'git' -Arguments @('rev-parse','origin/main') -WorkingDirectory $Root
$branch = Invoke-External -FilePath 'git' -Arguments @('rev-parse','--abbrev-ref','HEAD') -WorkingDirectory $Root
$sourceDrift = Invoke-External -FilePath 'git' -Arguments @('diff','--quiet','--exit-code','HEAD','--','API','CORE','SERVICES','SCRIPTS','CONNECTORS','WORKERS','TESTS','.github','FINAL_GO_LIVE.cmd','package.json','package-lock.json') -WorkingDirectory $Root
$headSha = if($head.output.Count){$head.output[0].Trim()}else{''}
$originSha = if($origin.output.Count){$origin.output[0].Trim()}else{''}
$branchName = if($branch.output.Count){$branch.output[0].Trim()}else{''}
Add-Check $checks 'PRODUCTION_HEAD_EQUALS_ORIGIN_MAIN' ($head.exitCode -eq 0 -and $origin.exitCode -eq 0 -and $headSha -eq $originSha) "head=$headSha originMain=$originSha" $true
Add-Check $checks 'PRODUCTION_BRANCH_MAIN' ($branchName -eq 'main') "branch=$branchName" $true
Add-Check $checks 'PRODUCTION_WORKTREE_CLEAN' ($sourceDrift.exitCode -eq 0) "trackedSourceControlDrift=$($sourceDrift.exitCode -ne 0); untracked runtime/data evidence allowed" $true

# 2. Existing read-only runtime/dashboard acceptance.
$productionAudit = Invoke-External -FilePath 'powershell.exe' -Arguments @('-NoProfile','-ExecutionPolicy','Bypass','-File','SCRIPTS\AUDIT_MILES_PRODUCTION_ACCEPTANCE.ps1','-Root',$Root) -WorkingDirectory $Root
$latestProdDir = Get-ChildItem -LiteralPath $env:TEMP -Directory -Filter 'MILES_PRODUCTION_ACCEPTANCE_*' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$prodReport = if($latestProdDir){Read-JsonSafe (Join-Path $latestProdDir.FullName 'miles_production_acceptance.json')}else{$null}
Add-Check $checks 'LIVE_RUNTIME_ACCEPTANCE' ($productionAudit.exitCode -eq 0 -and $prodReport -and $prodReport.ready_for_daily_use -eq $true) "exit=$($productionAudit.exitCode) ready=$($prodReport.ready_for_daily_use)" $true

# 3. Live Instantly/revenue read-only acceptance.
$revenueAudit = Invoke-External -FilePath 'node' -Arguments @('SCRIPTS/AUDIT_MILES_REVENUE_OPERATIONS.js',$Root) -WorkingDirectory $Root
$revenueReportPath = Join-Path $Root 'DATA\operational_acceptance\latest_revenue_operations_acceptance.json'
$revenue = Read-JsonSafe $revenueReportPath
$criticalRevenueChecks = @('instantly_read_connectivity','campaign_inventory','sender_account_inventory','reply_visibility','currently_looking_for_help','marketing_operation_freshness','meeting_pipeline_evidence')
$revenueGreen = $true
foreach($name in $criticalRevenueChecks) {
    $value = if($revenue -and $revenue.checks){[string]$revenue.checks.$name}else{''}
    if($value -ne 'GREEN') { $revenueGreen = $false }
}
Add-Check $checks 'LIVE_REVENUE_OPERATIONS' ($revenueAudit.exitCode -eq 0 -and $revenueGreen) "exit=$($revenueAudit.exitCode) criticalGreen=$revenueGreen" $true

# 4. Controlled-write gates required for actual autonomous response execution.
$envMap = Read-EnvMap (Join-Path $Root '.env')
$dryRun = Env-Bool $envMap 'MILES_DRY_RUN' $true
$allowMutations = Env-Bool $envMap 'MILES_ALLOW_INSTANTLY_MUTATIONS' $false
$controlledWrite = Env-Bool $envMap 'MILES_CONTROLLED_WRITE_ENABLED' $false
$instantlyWrite = Env-Bool $envMap 'INSTANTLY_WRITE_ENABLED' $false
$writeReady = (-not $dryRun) -and $allowMutations -and $controlledWrite -and $instantlyWrite
Add-Check $checks 'AUTONOMOUS_INSTANTLY_WRITE_GATES' $writeReady "dryRun=$dryRun allowMutations=$allowMutations controlledWrite=$controlledWrite instantlyWrite=$instantlyWrite" $true

# 5. Gmail executive triage must be autonomous and must not be bypassed by Gmail's legacy global forwarding.
$gmailTriageEnabled = Env-Bool $envMap 'MILES_GMAIL_EXECUTIVE_TRIAGE_ENABLED' $false
$gmailTriageExecute = Env-Bool $envMap 'MILES_GMAIL_EXECUTIVE_TRIAGE_EXECUTE' $false
$gmailInboxMutations = Env-Bool $envMap 'MILES_GOOGLE_INBOX_MUTATIONS' $false
$gmailExecutiveForward = Env-Bool $envMap 'MILES_GOOGLE_EXECUTIVE_FORWARD_ENABLED' $false
$gmailTriageReady = $gmailTriageEnabled -and $gmailTriageExecute -and $gmailInboxMutations -and $gmailExecutiveForward
Add-Check $checks 'GMAIL_EXECUTIVE_TRIAGE_GATES' $gmailTriageReady "enabled=$gmailTriageEnabled execute=$gmailTriageExecute inboxMutations=$gmailInboxMutations executiveForward=$gmailExecutiveForward" $true

# Plan-only triage reads every registered Gmail account and its auto-forwarding state. It never sends, labels, archives, or changes settings.
$gmailTriageAudit = Invoke-External -FilePath 'node' -Arguments @('SCRIPTS/RunGmailExecutiveTriage.js') -WorkingDirectory $Root
Add-Check $checks 'GMAIL_LEGACY_FORWARDING_DISABLED_AND_READABLE' ($gmailTriageAudit.exitCode -eq 0) "planOnlyExit=$($gmailTriageAudit.exitCode); legacy global Gmail forwarding must be disabled on every registered source inbox" $true

# 6. Composite control-plane regression on the live checkout. Tests use mocks/fixtures and do not send email.
$controlTests = @(
 'TESTS/single_taskqueue_executor_test.js','TESTS/single_coo_planner_test.js','TESTS/full_runtime_stability_test.js',
 'TESTS/full_product_functional_acceptance_test.js','TESTS/Test_OutboundSendingGovernance.js','TESTS/Test_RevenueOutboundReadinessAudit.js',
 'TESTS/Test_RevenueSegmentConfigurationApply.js','TESTS/Test_StateRevenueDeploymentRunner.js','TESTS/reply_intelligence_classification_test.js',
 'TESTS/reply_intelligence_production_loop_test.js','TESTS/executive_reply_surface_policy_test.js','TESTS/replacement_contact_recovery_test.js',
 'TESTS/replacement_contact_execution_test.js','TESTS/Test_InstantlyGuardedReplySend.js','TESTS/Test_AutonomousQualifiedReplyPolicy.js',
 'TESTS/Test_QualifiedReplyRevenueBridge.js','TESTS/Test_QualifiedReplyWorkerExecution.js','TESTS/Test_InstantlyMutationExecutionTruth.js',
 'TESTS/Test_RevenueCrmProgression.js','TESTS/Test_CooRevenueCrmProgressionWiring.js','TESTS/Test_OutboundToMeetingEndToEnd.js',
 'TESTS/Test_LeadSupplyChainCloseoutV8.js','TESTS/Test_GmailExecutiveTriageService.js'
)
$testFailures = @()
foreach($test in $controlTests) {
    $r = Invoke-External -FilePath 'node' -Arguments @($test) -WorkingDirectory $Root
    if($r.exitCode -ne 0) { $testFailures += $test }
}
Add-Check $checks 'AUTONOMOUS_REVENUE_CONTROL_PLANE' ($testFailures.Count -eq 0) "failed=$($testFailures -join ',')" $true

# 7. Truth-recovered contact intake and exact credit-capped batch.
$oldIntelligence = $env:P2GC_INTELLIGENCE_ROOT
$env:P2GC_INTELLIGENCE_ROOT = $IntelligenceRoot
try {
    $truthArgs = @('SCRIPTS/RunTruthRecoveredProductionGate.js','--prepare',"--credit-limit=$CreditLimit")
    $truthPrepare = Invoke-External -FilePath 'node' -Arguments $truthArgs -WorkingDirectory $Root
    $truthManifestPath = Join-Path $Root 'DATA\runtime\revenue\truth_recovered_production_gate\manifest.json'
    $truth = Read-JsonSafe $truthManifestPath
    $pending = if($truth){[int]$truth.verificationPending}else{-1}
    Add-Check $checks 'TRUTH_RECOVERED_INTAKE_AND_BATCH' ($truthPrepare.exitCode -eq 0 -and $truth -and $truth.ok -eq $true) "exit=$($truthPrepare.exitCode) pending=$pending selected=$($truth.selectedForVerification) held=$($truth.held)" $true

    $verificationReady = ($pending -eq 0)
    $verificationDetail = "pending=$pending; paid verification not required"
    if($pending -gt 0) {
        if($AuthorizePaidVerification) {
            $env:MILES_TRUTH_VERIFICATION_AUTHORIZATION = 'AUTHORIZE_TRUTH_RECOVERED_MILLIONVERIFIER_CREDIT_BURN'
            $verifyArgs = @('SCRIPTS/RunTruthRecoveredProductionGate.js','--verify',"--credit-limit=$CreditLimit")
            $truthVerify = Invoke-External -FilePath 'node' -Arguments $verifyArgs -WorkingDirectory $Root
            $truth = Read-JsonSafe $truthManifestPath
            $verificationReady = ($truthVerify.exitCode -eq 0 -and $truth -and [string]$truth.status -eq 'VERIFICATION_AND_RECONCILIATION_COMPLETED')
            $verificationDetail = "authorized=true exit=$($truthVerify.exitCode) status=$($truth.status) creditsUsed=$($truth.creditsUsed)"
        } else {
            $verificationReady = $false
            $verificationDetail = "pending=$pending; rerun with -AuthorizePaidVerification only if paid MillionVerifier credit use is approved"
        }
    }
    Add-Check $checks 'TRUTH_RECOVERED_EMAIL_VERIFICATION' $verificationReady $verificationDetail $true

    # 8. Produce #83's final named closeout artifacts from authoritative V8 + SLED verified master.
    $closeoutArgs = @('SCRIPTS/FinalizeLeadSupplyChainAudit.js','--apply',"--root=$Root", "--intelligence-root=$IntelligenceRoot")
    $closeoutRun = Invoke-External -FilePath 'node' -Arguments $closeoutArgs -WorkingDirectory $Root
    $closeoutManifestPath = Join-Path $Root 'DATA\revenue\lead_supply_chain_closeout\LEAD_SUPPLY_CHAIN_CLOSEOUT_MANIFEST.json'
    $closeout = Read-JsonSafe $closeoutManifestPath
    $closeoutGreen = ($closeoutRun.exitCode -eq 0 -and $closeout -and $closeout.ok -eq $true -and [string]$closeout.status -eq 'LEAD_SUPPLY_CLOSEOUT_GREEN')
    Add-Check $checks 'LEAD_SUPPLY_CHAIN_CLOSEOUT' $closeoutGreen "exit=$($closeoutRun.exitCode) status=$($closeout.status) companies=$($closeout.summary.authoritativeCompanies) fedSegments=$($closeout.summary.federalSegments) sledSegments=$($closeout.summary.sledSegments)" $true
} finally {
    $env:P2GC_INTELLIGENCE_ROOT = $oldIntelligence
    if($AuthorizePaidVerification) { Remove-Item Env:MILES_TRUTH_VERIFICATION_AUTHORIZATION -ErrorAction SilentlyContinue }
}

$hardFailures = @($checks | Where-Object { $_.hard -and -not $_.passed })
$statusText = if($hardFailures.Count -eq 0){'FULL_GO_GREEN'}else{'NOT_FULL_GO'}
$report = [ordered]@{
    generatedAt = (Get-Date).ToUniversalTime().ToString('o')
    audit = 'MILES_FULL_GO_PRODUCTION_ACCEPTANCE'
    status = $statusText
    fullGo = ($hardFailures.Count -eq 0)
    root = $Root
    intelligenceRoot = $IntelligenceRoot
    productionHead = $headSha
    originMain = $originSha
    branch = $branchName
    paidVerificationAuthorized = [bool]$AuthorizePaidVerification
    creditLimit = $CreditLimit
    checks = @($checks)
    hardBlockers = @($hardFailures | ForEach-Object { $_.name })
    safety = [ordered]@{
        acceptanceRunnerSentEmail = $false
        acceptanceRunnerActivatedCampaign = $false
        acceptanceRunnerUploadedInstantlyLead = $false
        gmailTriageAcceptanceIsPlanOnly = $true
        paidVerificationRequiresExplicitSwitch = $true
        secretsReported = $false
    }
}
$json = Join-Path $outDir 'MILES_FULL_GO_ACCEPTANCE.json'
$txt = Join-Path $outDir 'MILES_FULL_GO_ACCEPTANCE.txt'
$report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $json -Encoding UTF8
@(
    "MILES FULL GO PRODUCTION ACCEPTANCE",
    "Status: $statusText",
    "Full Go: $($report.fullGo)",
    "Production HEAD: $headSha",
    "origin/main: $originSha",
    "Hard blockers: $($hardFailures.Count)",
    ($hardFailures | ForEach-Object { "BLOCKER: $($_.name) -- $($_.detail)" }),
    "Report: $json"
) | Set-Content -LiteralPath $txt -Encoding UTF8

Write-Host '============================================================'
Write-Host 'MILES FULL GO PRODUCTION ACCEPTANCE'
Write-Host '============================================================'
Write-Host "STATUS: $statusText"
foreach($check in $checks) {
    $label = if($check.passed){'GREEN'}else{'RED'}
    Write-Host "$label  $($check.name)  $($check.detail)"
}
Write-Host "REPORT: $json"

if($hardFailures.Count -gt 0) { exit 2 }
exit 0