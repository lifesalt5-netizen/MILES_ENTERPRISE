param(
    [Parameter(Mandatory=$true)][string]$CandidateRoot,
    [string]$LiveRoot = "C:\P2GC_Intelligence\MILES_ENTERPRISE",
    [Parameter(Mandatory=$true)][string]$ExpectedCommit,
    [int]$TimeoutSeconds = 120
)

$ErrorActionPreference = "Stop"

$runner = Join-Path $CandidateRoot 'SCRIPTS\RUN_MILES_CUTOVER_REHEARSAL.ps1'
if (-not (Test-Path -LiteralPath $runner -PathType Leaf)) {
    throw "Canonical rehearsal runner not found: $runner"
}

# Verify the exact full candidate HEAD directly before invoking the canonical runner.
$actualHead = [string]((& git -C $CandidateRoot rev-parse HEAD 2>$null) | Select-Object -First 1)
if ($LASTEXITCODE -ne 0 -or -not $actualHead) {
    throw "Unable to resolve candidate HEAD: $CandidateRoot"
}
$actualHead = $actualHead.Trim()
if ($actualHead -ne $ExpectedCommit) {
    throw "Candidate HEAD mismatch. Expected $ExpectedCommit, found $actualHead"
}

$status = @(& git -C $CandidateRoot status --porcelain=v1 --untracked-files=all 2>$null)
if ($LASTEXITCODE -ne 0) { throw "Unable to inspect candidate Git status." }
if ($status.Count -ne 0) {
    throw "Candidate must be clean before rehearsal. Found $($status.Count) status entries."
}

# Windows PowerShell 5.1 unwraps a one-element function result to a scalar string.
# The canonical runner then indexes [0], which becomes the first character of the SHA.
# Patch only an ephemeral copy so the full reviewed ExpectedCommit remains enforced.
$source = Get-Content -Raw -LiteralPath $runner
$oldHead = '$head = (Get-GitValue $CandidateRoot @(''rev-parse'',''HEAD''))[0]'
$newHead = @'
$headValues = @(Get-GitValue $CandidateRoot @('rev-parse','HEAD'))
if ($headValues.Count -ne 1) { throw "Expected exactly one candidate HEAD value; found $($headValues.Count)" }
$head = [string]$headValues[0]
'@

$headMatches = ([regex]::Matches($source, [regex]::Escape($oldHead))).Count
if ($headMatches -ne 1) {
    throw "Canonical runner HEAD patch target changed. Expected 1 occurrence, found $headMatches."
}
$source = $source.Replace($oldHead, $newHead.TrimEnd())

# The legacy runtime can leave a Node child holding a canonical port even when its
# command line does not match the historical process-name pattern. Inject a safe
# ownership check into the ephemeral rehearsal copy. It may stop only node.exe
# processes whose command line points inside LiveRoot or CandidateRoot.
$helperMarker = 'function Wait-PortState([bool]$Listening,[int]$TimeoutSec) {'
$helperMatches = ([regex]::Matches($source, [regex]::Escape($helperMarker))).Count
if ($helperMatches -ne 1) {
    throw "Canonical runner helper insertion target changed. Expected 1 occurrence, found $helperMatches."
}

$helpers = @'
function Test-MilesRootOwnedCommandLine([string]$CommandLine) {
    if (-not $CommandLine) { return $false }
    $line = [string]$CommandLine
    $liveToken = [System.IO.Path]::GetFullPath($LiveRoot).TrimEnd('\')
    $candidateToken = [System.IO.Path]::GetFullPath($CandidateRoot).TrimEnd('\')
    return ($line.IndexOf($liveToken, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) -or
           ($line.IndexOf($candidateToken, [System.StringComparison]::OrdinalIgnoreCase) -ge 0)
}

function Get-CanonicalPortOwnerDetails {
    $details = @()
    foreach ($row in @(Get-PortRows | Where-Object { $_.listening })) {
        foreach ($pidValue in @($row.pids)) {
            $process = $null
            try {
                $process = Get-CimInstance Win32_Process -Filter "ProcessId=$pidValue" -ErrorAction Stop
            } catch {}
            $commandLine = if ($process) { [string]$process.CommandLine } else { '' }
            $name = if ($process) { [string]$process.Name } else { '' }
            $details += [pscustomobject]@{
                port = [int]$row.port
                pid = [int]$pidValue
                name = $name
                command_line = $commandLine
                miles_root_owned = [bool](Test-MilesRootOwnedCommandLine $commandLine)
            }
        }
    }
    return $details
}

function Stop-RootOwnedCanonicalPortProcesses {
    $stopped = @()
    foreach ($detail in @(Get-CanonicalPortOwnerDetails)) {
        if ($detail.name -ieq 'node.exe' -and $detail.miles_root_owned) {
            try {
                Stop-Process -Id $detail.pid -Force -ErrorAction Stop
                $stopped += $detail
            } catch {}
        }
    }
    return $stopped
}

function Assert-CanonicalPortsReleased {
    Start-Sleep -Milliseconds 750
    $remaining = @(Get-CanonicalPortOwnerDetails)
    if ($remaining.Count -eq 0) { return }

    Write-Host 'Canonical ports still owned after safe MILES stop:'
    foreach ($detail in $remaining) {
        Write-Host ("  port={0} pid={1} name={2} miles_root_owned={3} command={4}" -f `
            $detail.port, $detail.pid, $detail.name, $detail.miles_root_owned, $detail.command_line)
    }

    throw "Canonical port ownership remains after safe MILES stop. Refusing to kill unrelated processes."
}

'@
$source = $source.Replace($helperMarker, ($helpers + $helperMarker))

$oldStop = '$stopped = @(Stop-MilesNodes)'
$newStop = @'
$stopped = @(Stop-MilesNodes)
Start-Sleep -Milliseconds 750
$rootOwnedPortStops = @(Stop-RootOwnedCanonicalPortProcesses)
Assert-CanonicalPortsReleased
'@
$stopMatches = ([regex]::Matches($source, [regex]::Escape($oldStop))).Count
if ($stopMatches -ne 1) {
    throw "Canonical runner stop patch target changed. Expected 1 occurrence, found $stopMatches."
}
$source = $source.Replace($oldStop, $newStop.TrimEnd())

$oldFinalStop = 'Stop-MilesNodes | Out-Null'
$newFinalStop = @'
Stop-MilesNodes | Out-Null
Start-Sleep -Milliseconds 500
Stop-RootOwnedCanonicalPortProcesses | Out-Null
'@
$finalStopMatches = ([regex]::Matches($source, [regex]::Escape($oldFinalStop))).Count
if ($finalStopMatches -ne 1) {
    throw "Canonical runner final-stop patch target changed. Expected 1 occurrence, found $finalStopMatches."
}
$source = $source.Replace($oldFinalStop, $newFinalStop.TrimEnd())

$temp = Join-Path $env:TEMP ("RUN_MILES_CUTOVER_REHEARSAL_WINDOWS_{0}.ps1" -f ([guid]::NewGuid().ToString('N')))
try {
    [System.IO.File]::WriteAllText($temp, $source, [System.Text.Encoding]::ASCII)

    & powershell -NoProfile -ExecutionPolicy Bypass `
        -File $temp `
        -CandidateRoot $CandidateRoot `
        -LiveRoot $LiveRoot `
        -ExpectedCommit $ExpectedCommit `
        -TimeoutSeconds $TimeoutSeconds

    exit $LASTEXITCODE
}
finally {
    Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
}
