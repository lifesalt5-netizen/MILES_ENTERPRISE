param(
    [Parameter(Mandatory=$true)][string]$CandidateRoot,
    [string]$LiveRoot = "C:\P2GC_Intelligence\MILES_ENTERPRISE",
    [int]$TimeoutSeconds = 120
)

$ErrorActionPreference = "Stop"
$ports = @(3000,8787,3737,8737)
$protectedTopLevel = @('DATA','CONFIG','.env')
$pm2Projector = Join-Path $CandidateRoot 'SCRIPTS\project_pm2_jlist.js'
$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$reportPath = Join-Path $env:TEMP ("MILES_CUTOVER_LOCK_PREFLIGHT_{0}.json" -f $stamp)

function Normalize-Root([string]$PathValue) {
    return [System.IO.Path]::GetFullPath($PathValue).TrimEnd('\')
}

function Test-PathInsideRoot([string]$PathValue,[string]$RootValue) {
    if (-not $PathValue) { return $false }
    try {
        $path = Normalize-Root $PathValue
        $root = Normalize-Root $RootValue
        return $path.Equals($root,[System.StringComparison]::OrdinalIgnoreCase) -or
            $path.StartsWith($root + '\',[System.StringComparison]::OrdinalIgnoreCase)
    } catch { return $false }
}

function Get-Pm2Apps {
    $rawPath = Join-Path $env:TEMP ("MILES_PM2_JLIST_{0}.json" -f ([guid]::NewGuid().ToString('N')))
    try {
        $rawLines = @(& pm2 jlist 2>$null)
        if ($LASTEXITCODE -ne 0) { throw 'pm2 jlist failed.' }
        [System.IO.File]::WriteAllText($rawPath,(($rawLines | ForEach-Object { [string]$_ }) -join "`n"),[System.Text.Encoding]::UTF8)
        $projected = @(& node $pm2Projector $rawPath 2>$null)
        if ($LASTEXITCODE -ne 0) { throw 'PM2 projector failed.' }
        $apps = @()
        foreach ($line in $projected) {
            if (-not ([string]$line).Trim()) { continue }
            $parts = ([string]$line) -split "`t",6
            if ($parts.Count -ne 6) { throw "Invalid PM2 projection row: $line" }
            $apps += [pscustomobject]@{
                pid=if($parts[0]){[int]$parts[0]}else{0}
                pm_id=if($parts[1]){[int]$parts[1]}else{-1}
                name=[string]$parts[2]
                status=[string]$parts[3]
                pm_cwd=[string]$parts[4]
                pm_exec_path=[string]$parts[5]
            }
        }
        return @($apps)
    } finally {
        Remove-Item -LiteralPath $rawPath -Force -ErrorAction SilentlyContinue
    }
}

function Get-LivePm2Apps {
    $selected = @()
    foreach ($app in @(Get-Pm2Apps)) {
        if ((Test-PathInsideRoot ([string]$app.pm_cwd) $LiveRoot) -or (Test-PathInsideRoot ([string]$app.pm_exec_path) $LiveRoot)) {
            $selected += [pscustomobject]@{
                pm_id=[int]$app.pm_id
                name=[string]$app.name
                restore=[bool](([string]$app.status -eq 'online') -or ([int]$app.pid -gt 0))
            }
        }
    }
    return @($selected | Sort-Object pm_id -Unique)
}

function Get-PortOwners {
    $rows = @()
    foreach ($port in $ports) {
        foreach ($connection in @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)) {
            $rows += [pscustomobject]@{port=[int]$port;pid=[int]$connection.OwningProcess}
        }
    }
    return @($rows | Sort-Object port,pid -Unique)
}

function Wait-Ports([bool]$Listening,[int]$Seconds) {
    $deadline = (Get-Date).AddSeconds($Seconds)
    do {
        $owned = @(Get-PortOwners | Select-Object -ExpandProperty port -Unique)
        if ($Listening -and $owned.Count -eq $ports.Count) { return $true }
        if (-not $Listening -and $owned.Count -eq 0) { return $true }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    return $false
}

if (-not (Test-Path -LiteralPath $CandidateRoot -PathType Container)) { throw "Candidate root missing: $CandidateRoot" }
if (-not (Test-Path -LiteralPath $LiveRoot -PathType Container)) { throw "Live root missing: $LiveRoot" }
if (-not (Test-Path -LiteralPath $pm2Projector -PathType Leaf)) { throw "PM2 projector missing: $pm2Projector" }

$pm2Apps = @(Get-LivePm2Apps)
if ($pm2Apps.Count -eq 0) { throw 'No PM2 apps proven to belong to live MILES root.' }
$restoreApps = @($pm2Apps | Where-Object { $_.restore })
$items = @()
foreach ($item in @(Get-ChildItem -LiteralPath $CandidateRoot -Force)) {
    if ($protectedTopLevel -contains $item.Name) { continue }
    if (Test-Path -LiteralPath (Join-Path $LiveRoot $item.Name)) { $items += $item.Name }
}
$items = @($items | Sort-Object -Unique)

$locked = New-Object System.Collections.Generic.List[object]
$tested = New-Object System.Collections.Generic.List[string]
$restoreOk = $false

Write-Host '============================================================'
Write-Host 'MILES IN-PLACE CUTOVER LOCK PREFLIGHT'
Write-Host '============================================================'
Write-Host "Live root: $LiveRoot"
Write-Host "Candidate root: $CandidateRoot"
Write-Host "PM2 live-root entries to pause: $($pm2Apps.Count)"
Write-Host "Source/control items to test: $($items.Count)"
Write-Host 'No candidate source will be promoted.'
Write-Host 'Protected in place: .env, DATA, CONFIG.'

try {
    foreach ($app in $pm2Apps) {
        & pm2 stop $app.pm_id | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "pm2 stop failed for id=$($app.pm_id) name=$($app.name)" }
    }
    if (-not (Wait-Ports $false 30)) { throw 'Canonical ports did not close after PM2 stop.' }

    foreach ($name in $items) {
        $liveItem = Join-Path $LiveRoot $name
        $probeName = ".miles_lockprobe_${stamp}_$([guid]::NewGuid().ToString('N'))"
        $probePath = Join-Path $LiveRoot $probeName
        try {
            Rename-Item -LiteralPath $liveItem -NewName $probeName -ErrorAction Stop
            try {
                Rename-Item -LiteralPath $probePath -NewName $name -ErrorAction Stop
            } catch {
                throw "RESTORE_FAILED for $name`: $($_.Exception.Message)"
            }
            $tested.Add($name)
        } catch {
            if (Test-Path -LiteralPath $probePath) {
                try { Rename-Item -LiteralPath $probePath -NewName $name -ErrorAction Stop } catch {
                    throw "FATAL_PROBE_RESTORE_FAILED for $name`: $($_.Exception.Message)"
                }
            }
            $locked.Add([pscustomobject]@{name=$name;error=$_.Exception.Message})
        }
    }
}
finally {
    foreach ($app in $restoreApps) {
        try { & pm2 restart $app.pm_id | Out-Null } catch {}
    }
    $restoreOk = Wait-Ports $true $TimeoutSeconds

    $report = [ordered]@{
        generated_at=(Get-Date).ToUniversalTime().ToString('o')
        live_root=$LiveRoot
        candidate_root=$CandidateRoot
        pm2_entries=$pm2Apps.Count
        tested_items=@($tested.ToArray())
        locked_items=@($locked.ToArray())
        locked_count=$locked.Count
        canonical_ports_restored=$restoreOk
        candidate_source_promoted=$false
        env_touched=$false
        data_touched=$false
        config_touched=$false
    }
    $report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $reportPath -Encoding UTF8

    Write-Host ''
    Write-Host "Lock preflight complete: True"
    Write-Host "Locked items: $($locked.Count)"
    foreach ($row in $locked) { Write-Host "  LOCKED: $($row.name) :: $($row.error)" }
    Write-Host "Canonical ports restored: $restoreOk"
    Write-Host 'Candidate source promoted: False'
    Write-Host "Report: $reportPath"
}

if (-not $restoreOk) { exit 2 }
if ($locked.Count -gt 0) { exit 3 }
exit 0
