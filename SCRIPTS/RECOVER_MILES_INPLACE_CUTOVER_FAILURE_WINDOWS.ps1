param(
    [string]$LiveRoot = "C:\P2GC_Intelligence\MILES_ENTERPRISE",
    [Parameter(Mandatory=$true)][string]$RollbackSource,
    [int]$TimeoutSeconds = 120
)

$ErrorActionPreference = "Stop"
$ports = @(3000,8787,3737,8737)
$pm2Names = @(
    'miles-command-center',
    'miles-api',
    'miles-executive-dashboard',
    'miles-desktop-ui',
    'miles-autonomous-coo',
    'p2gc-growth-demo',
    'p2gc-customer-delivery',
    'miles-worker',
    'miles-queue-maintainer'
)

function Wait-CanonicalPorts([int]$Seconds) {
    $deadline = (Get-Date).AddSeconds($Seconds)
    do {
        $listening = @()
        foreach ($port in $ports) {
            if (@(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue).Count -gt 0) {
                $listening += $port
            }
        }
        if (@($listening | Sort-Object -Unique).Count -eq $ports.Count) { return $true }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    return $false
}

if (-not (Test-Path -LiteralPath $LiveRoot -PathType Container)) { throw "Live root missing: $LiveRoot" }
if (-not (Test-Path -LiteralPath $RollbackSource -PathType Container)) { throw "Rollback source missing: $RollbackSource" }
if (-not (Get-Command pm2 -ErrorAction SilentlyContinue)) { throw 'pm2 command not found in PATH.' }

Write-Host '============================================================'
Write-Host 'MILES PARTIAL CUTOVER RECOVERY'
Write-Host '============================================================'
Write-Host "Live root:       $LiveRoot"
Write-Host "Rollback source: $RollbackSource"

$restored = New-Object System.Collections.Generic.List[string]
$alreadyPresent = New-Object System.Collections.Generic.List[string]

foreach ($item in @(Get-ChildItem -LiteralPath $RollbackSource -Force)) {
    $destination = Join-Path $LiveRoot $item.Name
    if (Test-Path -LiteralPath $destination) {
        $alreadyPresent.Add($item.Name)
        continue
    }
    Move-Item -LiteralPath $item.FullName -Destination $destination
    $restored.Add($item.Name)
}

Write-Host "Restored parked source items: $($restored.Count)"
if ($alreadyPresent.Count -gt 0) {
    Write-Host "Items already present and left untouched: $($alreadyPresent.Count)"
}

$restartErrors = @()
foreach ($name in $pm2Names) {
    & pm2 restart $name | Out-Null
    if ($LASTEXITCODE -ne 0) { $restartErrors += $name }
}
if ($restartErrors.Count -gt 0) { throw "PM2 restart failed for: $($restartErrors -join ', ')" }

if (-not (Wait-CanonicalPorts $TimeoutSeconds)) {
    throw 'Canonical MILES ports did not all return after recovery.'
}

Write-Host ''
Write-Host 'Recovery succeeded: True'
Write-Host 'Canonical ports restored: True'
Write-Host 'No candidate source was promoted by this recovery.'
exit 0
