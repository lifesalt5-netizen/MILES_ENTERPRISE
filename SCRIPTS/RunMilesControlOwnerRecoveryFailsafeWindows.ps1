param(
    [string]$Root = "C:\P2GC_Intelligence\MILES_ENTERPRISE",
    [Parameter(Mandatory=$true)][string]$ProofId,
    [int]$DelaySeconds = 300
)

$ErrorActionPreference = "Stop"
$EnsureScript = Join-Path $Root "SCRIPTS\EnsureMilesControlOwnerWindows.ps1"
$CancelMarker = Join-Path $Root ("DATA\runtime\control_owner_recovery_failsafe_cancel_" + $ProofId + ".json")
$EvidencePath = Join-Path $Root "DATA\runtime\control_owner_recovery_failsafe_latest.json"

function Write-Evidence {
    param([bool]$Ok, [string]$Status, [string]$Action, [string]$ErrorMessage = $null)
    $parent = Split-Path -Parent $EvidencePath
    if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
    $payload = [ordered]@{
        ok = $Ok
        status = $Status
        action = $Action
        proofId = $ProofId
        delaySeconds = $DelaySeconds
        observedAt = (Get-Date).ToUniversalTime().ToString("o")
        error = $ErrorMessage
        safety = [ordered]@{
            fixedEnsureScriptOnly = $true
            arbitraryShell = $false
            gitMutation = $false
            providerMutation = $false
            sendsProspects = $false
            deletesEmail = $false
            changesDns = $false
            publishesB12 = $false
        }
    }
    $payload | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $EvidencePath -Encoding UTF8
    return $payload
}

try {
    if ($env:OS -ne "Windows_NT") { throw "WINDOWS_REQUIRED" }
    if (-not (Test-Path -LiteralPath $EnsureScript)) { throw "FAILSAFE_ENSURE_SCRIPT_NOT_FOUND:$EnsureScript" }
    if ($DelaySeconds -lt 30 -or $DelaySeconds -gt 900) { throw "FAILSAFE_DELAY_OUT_OF_RANGE" }

    Start-Sleep -Seconds $DelaySeconds
    if (Test-Path -LiteralPath $CancelMarker) {
        $evidence = Write-Evidence -Ok $true -Status "CONTROL_OWNER_RECOVERY_FAILSAFE_CANCELED" -Action "NONE_PRIMARY_WATCHDOG_RECOVERED"
        Write-Host ($evidence | ConvertTo-Json -Compress -Depth 5)
        exit 0
    }

    & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $EnsureScript -Root $Root | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "FAILSAFE_ENSURE_FAILED" }

    $evidence = Write-Evidence -Ok $true -Status "CONTROL_OWNER_RECOVERY_FAILSAFE_EXECUTED" -Action "FIXED_ENSURE_SCRIPT"
    Write-Host ($evidence | ConvertTo-Json -Compress -Depth 5)
    exit 0
}
catch {
    $message = $_.Exception.Message
    $evidence = Write-Evidence -Ok $false -Status "CONTROL_OWNER_RECOVERY_FAILSAFE_RED" -Action "FAIL_CLOSED" -ErrorMessage $message
    Write-Error $message
    Write-Host ($evidence | ConvertTo-Json -Compress -Depth 5)
    exit 2
}
