param(
    [string]$Root = "C:\P2GC_Intelligence\MILES_ENTERPRISE",
    [double]$DurationHours = 24,
    [int]$SampleMinutes = 60,
    [int]$MaxFullGoArtifactAgeMinutes = 120,
    [switch]$PlanOnly
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
    [pscustomobject]@{ exitCode=$code; output=@($output) }
}

function Read-JsonSafe([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    try { Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json } catch { $null }
}

function Find-LatestFullGo {
    $root = Join-Path $Root 'DATA\operational_acceptance'
    if (-not (Test-Path $root)) { return $null }
    $file = Get-ChildItem -LiteralPath $root -Recurse -File -Filter 'MILES_FULL_GO_ACCEPTANCE.json' -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $file) { return $null }
    $report = Read-JsonSafe $file.FullName
    if (-not $report) { return $null }
    [pscustomobject]@{ file=$file; report=$report }
}

$DurationHours = [Math]::Max(1, $DurationHours)
$SampleMinutes = [Math]::Max(5, $SampleMinutes)

if ($PlanOnly) {
    [ordered]@{
        audit='MILES_24H_AUTONOMOUS_SOAK'
        mode='PLAN_ONLY'
        durationHours=$DurationHours
        sampleMinutes=$SampleMinutes
        prerequisites=@('FRESH_FULL_GO_GREEN','SAME_PRODUCTION_COMMIT','LIVE_RUNTIME_GREEN','LIVE_REVENUE_GREEN','NO_SEND_WINDOW_VIOLATIONS')
        externalMutations=$false
    } | ConvertTo-Json -Depth 6
    exit 0
}

if (-not (Test-Path -LiteralPath $Root -PathType Container)) { throw "MILES root not found: $Root" }
$fullGo = Find-LatestFullGo
if (-not $fullGo) { throw 'No prior MILES_FULL_GO_ACCEPTANCE.json found. Run FULL GO acceptance first.' }
$ageMinutes = ((Get-Date) - $fullGo.file.LastWriteTime).TotalMinutes
if ($fullGo.report.fullGo -ne $true -or [string]$fullGo.report.status -ne 'FULL_GO_GREEN') { throw 'Latest FULL GO artifact is not GREEN.' }
if ($ageMinutes -gt $MaxFullGoArtifactAgeMinutes) { throw "Latest FULL GO artifact is too old ($([math]::Round($ageMinutes,1)) minutes). Rerun FULL GO acceptance first." }
$acceptedSha = [string]$fullGo.report.productionHead
if (-not $acceptedSha) { throw 'FULL GO artifact does not record productionHead.' }

$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$outDir = Join-Path $Root "DATA\operational_acceptance\AUTONOMOUS_SOAK_$stamp"
New-Item -ItemType Directory -Path $outDir -Force | Out-Null
$start = Get-Date
$deadline = $start.AddHours($DurationHours)
$startIso = $start.ToUniversalTime().ToString('o')
$samples = New-Object System.Collections.ArrayList

Write-Host '============================================================'
Write-Host 'MILES AUTONOMOUS SOAK'
Write-Host '============================================================'
Write-Host "Start: $startIso"
Write-Host "Duration: $DurationHours hours"
Write-Host "Sample interval: $SampleMinutes minutes"
Write-Host "Accepted production commit: $acceptedSha"

while ((Get-Date) -lt $deadline) {
    $at = (Get-Date).ToUniversalTime().ToString('o')
    $headRun = Invoke-External -FilePath 'git' -Arguments @('rev-parse','HEAD') -WorkingDirectory $Root
    $head = if($headRun.output.Count){$headRun.output[0].Trim()}else{''}

    $prod = Invoke-External -FilePath 'powershell.exe' -Arguments @('-NoProfile','-ExecutionPolicy','Bypass','-File','SCRIPTS\AUDIT_MILES_PRODUCTION_ACCEPTANCE.ps1','-Root',$Root) -WorkingDirectory $Root
    $latestProdDir = Get-ChildItem -LiteralPath $env:TEMP -Directory -Filter 'MILES_PRODUCTION_ACCEPTANCE_*' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    $prodReport = if($latestProdDir){Read-JsonSafe (Join-Path $latestProdDir.FullName 'miles_production_acceptance.json')}else{$null}
    $runtimeGreen = ($prod.exitCode -eq 0 -and $prodReport -and $prodReport.ready_for_daily_use -eq $true)

    $revenueRun = Invoke-External -FilePath 'node' -Arguments @('SCRIPTS/AUDIT_MILES_REVENUE_OPERATIONS.js',$Root) -WorkingDirectory $Root
    $revenue = Read-JsonSafe (Join-Path $Root 'DATA\operational_acceptance\latest_revenue_operations_acceptance.json')
    $critical = @('instantly_read_connectivity','campaign_inventory','sender_account_inventory','reply_visibility','currently_looking_for_help','marketing_operation_freshness','meeting_pipeline_evidence')
    $revenueGreen = ($revenueRun.exitCode -eq 0)
    foreach($name in $critical) {
        if(-not $revenue -or [string]$revenue.checks.$name -ne 'GREEN') { $revenueGreen = $false }
    }

    $sendRun = Invoke-External -FilePath 'node' -Arguments @('SCRIPTS/AuditInstantlySendWindowHistory.js',"--root=$Root", "--since=$startIso") -WorkingDirectory $Root
    $sendReport = Read-JsonSafe (Join-Path $Root 'DATA\operational_acceptance\send_window_history\INSTANTLY_SEND_WINDOW_HISTORY_LATEST.json')
    $sendWindowGreen = ($sendRun.exitCode -eq 0 -and $sendReport -and $sendReport.ok -eq $true)

    $sample = [ordered]@{
        at=$at
        productionHead=$head
        sameCommit=($head -eq $acceptedSha)
        runtimeGreen=$runtimeGreen
        revenueGreen=$revenueGreen
        sendWindowGreen=$sendWindowGreen
        sentMessagesInspected=if($sendReport){[int]$sendReport.sentMessagesInspected}else{0}
        sendWindowViolations=if($sendReport){[int]$sendReport.violations}else{-1}
        invalidSendTimestamps=if($sendReport){[int]$sendReport.invalidTimestamps}else{-1}
    }
    [void]$samples.Add([pscustomobject]$sample)
    $sample | ConvertTo-Json -Depth 6 | Add-Content -LiteralPath (Join-Path $outDir 'SOAK_SAMPLES.jsonl') -Encoding UTF8

    $green = $sample.sameCommit -and $sample.runtimeGreen -and $sample.revenueGreen -and $sample.sendWindowGreen
    Write-Host ("{0}  {1}  commit={2} runtime={3} revenue={4} sendWindow={5} violations={6}" -f ($(if($green){'GREEN'}else{'RED'}),$at,$sample.sameCommit,$runtimeGreen,$revenueGreen,$sendWindowGreen,$sample.sendWindowViolations))
    if(-not $green) {
        $failure = [ordered]@{
            ok=$false
            status='AUTONOMOUS_SOAK_FAILED'
            startedAt=$startIso
            failedAt=$at
            acceptedProductionHead=$acceptedSha
            samples=@($samples)
            blocker=$sample
            externalMutationsBySoakRunner=$false
        }
        $failure | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $outDir 'MILES_24H_AUTONOMOUS_SOAK.json') -Encoding UTF8
        exit 2
    }

    $remainingSeconds = ($deadline - (Get-Date)).TotalSeconds
    if($remainingSeconds -le 0) { break }
    Start-Sleep -Seconds ([int][Math]::Min($SampleMinutes * 60, $remainingSeconds))
}

# Final sample-independent send-window check over the entire soak interval.
$finalSendRun = Invoke-External -FilePath 'node' -Arguments @('SCRIPTS/AuditInstantlySendWindowHistory.js',"--root=$Root", "--since=$startIso") -WorkingDirectory $Root
$finalSend = Read-JsonSafe (Join-Path $Root 'DATA\operational_acceptance\send_window_history\INSTANTLY_SEND_WINDOW_HISTORY_LATEST.json')
$allGreen = @($samples | Where-Object { -not ($_.sameCommit -and $_.runtimeGreen -and $_.revenueGreen -and $_.sendWindowGreen) }).Count -eq 0
$durationObserved = ((Get-Date) - $start).TotalHours
$completed = $allGreen -and $durationObserved -ge ($DurationHours - 0.01) -and $finalSendRun.exitCode -eq 0 -and $finalSend -and $finalSend.ok -eq $true

$result = [ordered]@{
    ok=$completed
    status=if($completed){'24H_AUTONOMOUS_SOAK_GREEN'}else{'AUTONOMOUS_SOAK_INCOMPLETE'}
    startedAt=$startIso
    completedAt=(Get-Date).ToUniversalTime().ToString('o')
    requestedDurationHours=$DurationHours
    observedDurationHours=[math]::Round($durationObserved,3)
    sampleMinutes=$SampleMinutes
    sampleCount=$samples.Count
    acceptedProductionHead=$acceptedSha
    sameCommitAllSamples=(@($samples | Where-Object { -not $_.sameCommit }).Count -eq 0)
    runtimeGreenAllSamples=(@($samples | Where-Object { -not $_.runtimeGreen }).Count -eq 0)
    revenueGreenAllSamples=(@($samples | Where-Object { -not $_.revenueGreen }).Count -eq 0)
    sendWindowGreenAllSamples=(@($samples | Where-Object { -not $_.sendWindowGreen }).Count -eq 0)
    finalSendWindowViolations=if($finalSend){[int]$finalSend.violations}else{-1}
    finalInvalidSendTimestamps=if($finalSend){[int]$finalSend.invalidTimestamps}else{-1}
    sentMessagesInspected=if($finalSend){[int]$finalSend.sentMessagesInspected}else{0}
    fullGoArtifact=$fullGo.file.FullName
    externalMutationsBySoakRunner=$false
}
$result | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $outDir 'MILES_24H_AUTONOMOUS_SOAK.json') -Encoding UTF8
Write-Host "STATUS: $($result.status)"
Write-Host "REPORT: $(Join-Path $outDir 'MILES_24H_AUTONOMOUS_SOAK.json')"
if(-not $completed){exit 2}
exit 0
