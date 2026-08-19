param(
    [Parameter(Mandatory=$true)][string]$CandidateRoot,
    [string]$LiveRoot = "C:\P2GC_Intelligence\MILES_ENTERPRISE",
    [Parameter(Mandatory=$true)][string]$ExpectedCommit,
    [int]$TimeoutSeconds = 120
)

$ErrorActionPreference = "Stop"
$ports = @(3000,8787,3737,8737)
$windowsRunner = Join-Path $CandidateRoot 'SCRIPTS\RUN_MILES_CUTOVER_REHEARSAL_WINDOWS.ps1'
$pm2Projector = Join-Path $CandidateRoot 'SCRIPTS\project_pm2_jlist.js'

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
    } catch {
        return $false
    }
}

function Get-Pm2Apps {
    if (-not (Get-Command pm2 -ErrorAction SilentlyContinue)) {
        throw 'pm2 command not found in PATH.'
    }
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        throw 'node command not found in PATH.'
    }
    if (-not (Test-Path -LiteralPath $pm2Projector -PathType Leaf)) {
        throw "PM2 projector not found: $pm2Projector"
    }

    $rawPath = Join-Path $env:TEMP ("MILES_PM2_JLIST_{0}.json" -f ([guid]::NewGuid().ToString('N')))
    try {
        $rawLines = @(& pm2 jlist 2>$null)
        if ($LASTEXITCODE -ne 0) { throw 'pm2 jlist failed.' }
        $raw = ($rawLines | ForEach-Object { [string]$_ }) -join "`n"
        if (-not $raw.Trim()) { throw 'pm2 jlist returned no data.' }
        [System.IO.File]::WriteAllText($rawPath, $raw, [System.Text.Encoding]::UTF8)

        # Windows PowerShell ConvertFrom-Json is case-insensitive and rejects PM2 env
        # objects that legitimately contain both keys such as username and USERNAME.
        # A checked-in Node helper parses the original JSON and projects only the
        # six fields this rehearsal needs. Avoid inline eval because Windows quoting is fragile.
        $projected = @(& node $pm2Projector $rawPath 2>$null)
        if ($LASTEXITCODE -ne 0) { throw 'Node PM2 projector failed.' }

        $apps = @()
        foreach ($line in $projected) {
            if (-not ([string]$line).Trim()) { continue }
            $parts = ([string]$line) -split "`t", 6
            if ($parts.Count -ne 6) { throw "Invalid PM2 projection row: $line" }
            $apps += [pscustomobject]@{
                pid = if($parts[0]){[int]$parts[0]}else{0}
                pm_id = if($parts[1]){[int]$parts[1]}else{-1}
                name = [string]$parts[2]
                status = [string]$parts[3]
                pm_cwd = [string]$parts[4]
                pm_exec_path = [string]$parts[5]
            }
        }
        return @($apps)
    }
    finally {
        Remove-Item -LiteralPath $rawPath -Force -ErrorAction SilentlyContinue
    }
}

function Get-PortOwnerRows {
    $rows = @()
    foreach ($port in $ports) {
        $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
        foreach ($pid in @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)) {
            $rows += [pscustomobject]@{ port=[int]$port; pid=[int]$pid }
        }
    }
    return @($rows)
}

function Resolve-Pm2MilesOwners {
    $apps = @(Get-Pm2Apps)
    $owners = @(Get-PortOwnerRows)
    if ($owners.Count -eq 0) { return @() }

    $resolved = @()
    foreach ($owner in $owners) {
        $matches = @($apps | Where-Object { [int]$_.pid -eq [int]$owner.pid })
        if ($matches.Count -ne 1) {
            throw "Port $($owner.port) owner PID $($owner.pid) is not uniquely represented in pm2 jlist."
        }

        $app = $matches[0]
        $cwd = [string]$app.pm_cwd
        $execPath = [string]$app.pm_exec_path
        $rootOwned = (Test-PathInsideRoot $cwd $LiveRoot) -or (Test-PathInsideRoot $execPath $LiveRoot)
        if (-not $rootOwned) {
            throw "Refusing to stop PM2 app '$($app.name)' id=$($app.pm_id) for port $($owner.port): cwd/exec path is outside live MILES root. cwd=$cwd exec=$execPath"
        }

        $resolved += [pscustomobject]@{
            port=[int]$owner.port
            pid=[int]$owner.pid
            pm_id=[int]$app.pm_id
            name=[string]$app.name
            status=[string]$app.status
            cwd=$cwd
            exec_path=$execPath
        }
    }
    return @($resolved)
}

function Wait-CanonicalPorts([bool]$Listening,[int]$TimeoutSec) {
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    do {
        $rows = @(Get-PortOwnerRows)
        $listeningPorts = @($rows | Select-Object -ExpandProperty port -Unique)
        if ($Listening) {
            if ($listeningPorts.Count -eq $ports.Count) { return $true }
        } else {
            if ($listeningPorts.Count -eq 0) { return $true }
        }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)

    $state = @(Get-PortOwnerRows | ForEach-Object { "port=$($_.port) pid=$($_.pid)" }) -join '; '
    throw "Timed out waiting for canonical ports listening=$Listening. Current owners: $state"
}

if (-not (Test-Path -LiteralPath $windowsRunner -PathType Leaf)) {
    throw "Windows rehearsal runner not found: $windowsRunner"
}
if (-not (Test-Path -LiteralPath $pm2Projector -PathType Leaf)) {
    throw "PM2 projector not found: $pm2Projector"
}

$actualHead = [string]((& git -C $CandidateRoot rev-parse HEAD 2>$null) | Select-Object -First 1)
if ($LASTEXITCODE -ne 0 -or -not $actualHead) { throw 'Unable to resolve candidate HEAD.' }
$actualHead = $actualHead.Trim()
if ($actualHead -ne $ExpectedCommit) {
    throw "Candidate HEAD mismatch. Expected $ExpectedCommit, found $actualHead"
}

$status = @(& git -C $CandidateRoot status --porcelain=v1 --untracked-files=all 2>$null)
if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect candidate Git status.' }
if ($status.Count -ne 0) { throw "Candidate must be clean before rehearsal. Found $($status.Count) status entries." }

$pm2Owners = @(Resolve-Pm2MilesOwners)
$pm2Apps = @($pm2Owners | Sort-Object pm_id -Unique)
$pm2WasManagingMiles = ($pm2Apps.Count -gt 0)
$runnerExit = 1
$restoreOk = $false

Write-Host '============================================================'
Write-Host 'MILES PM2-AWARE CONTROLLED CUTOVER REHEARSAL'
Write-Host '============================================================'
Write-Host "Candidate: $CandidateRoot"
Write-Host "Live:      $LiveRoot"
Write-Host "Commit:    $ExpectedCommit"
Write-Host "PM2 MILES apps owning canonical ports: $($pm2Apps.Count)"
foreach ($app in $pm2Apps) {
    Write-Host "  pm_id=$($app.pm_id) name=$($app.name) pid=$($app.pid) cwd=$($app.cwd)"
}
Write-Host 'Safety: only PM2 apps proven to belong to the live MILES root may be stopped.'
Write-Host 'No PM2 app definitions are deleted or rewritten.'

try {
    if ($pm2WasManagingMiles) {
        Write-Host ''
        Write-Host 'Stopping exact PM2-managed MILES apps for rehearsal window...'
        foreach ($app in $pm2Apps) {
            & pm2 stop $app.pm_id | Out-Null
            if ($LASTEXITCODE -ne 0) { throw "pm2 stop failed for id=$($app.pm_id) name=$($app.name)" }
        }
        Wait-CanonicalPorts $false 30 | Out-Null
    }

    Write-Host 'Launching zero-execution candidate rehearsal...'
    & powershell -NoProfile -ExecutionPolicy Bypass `
        -File $windowsRunner `
        -CandidateRoot $CandidateRoot `
        -LiveRoot $LiveRoot `
        -ExpectedCommit $ExpectedCommit `
        -TimeoutSeconds $TimeoutSeconds
    $runnerExit = $LASTEXITCODE
}
finally {
    if ($pm2WasManagingMiles) {
        Write-Host ''
        Write-Host 'Restoring exact PM2-managed MILES apps...'
        $restoreErrors = @()
        foreach ($app in $pm2Apps) {
            & pm2 restart $app.pm_id | Out-Null
            if ($LASTEXITCODE -ne 0) {
                $restoreErrors += "id=$($app.pm_id) name=$($app.name)"
            }
        }

        if ($restoreErrors.Count -eq 0) {
            try {
                Wait-CanonicalPorts $true $TimeoutSeconds | Out-Null
                $restoreOk = $true
            } catch {
                $restoreOk = $false
                Write-Host "PM2 restore readiness failed: $($_.Exception.Message)"
            }
        } else {
            $restoreOk = $false
            Write-Host "PM2 restart failed for: $($restoreErrors -join ', ')"
        }
    } else {
        $restoreOk = $true
    }
}

Write-Host ''
Write-Host "Underlying rehearsal exit code: $runnerExit"
Write-Host "PM2 live runtime restored: $restoreOk"

if ($runnerExit -ne 0 -or -not $restoreOk) { exit 1 }
exit 0
