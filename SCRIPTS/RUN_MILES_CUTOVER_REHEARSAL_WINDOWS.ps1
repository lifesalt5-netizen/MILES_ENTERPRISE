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
$old = '$head = (Get-GitValue $CandidateRoot @(''rev-parse'',''HEAD''))[0]'
$new = @'
$headValues = @(Get-GitValue $CandidateRoot @('rev-parse','HEAD'))
if ($headValues.Count -ne 1) { throw "Expected exactly one candidate HEAD value; found $($headValues.Count)" }
$head = [string]$headValues[0]
'@

$matches = ([regex]::Matches($source, [regex]::Escape($old))).Count
if ($matches -ne 1) {
    throw "Canonical runner patch target changed. Expected 1 occurrence, found $matches."
}

$temp = Join-Path $env:TEMP ("RUN_MILES_CUTOVER_REHEARSAL_WINDOWS_{0}.ps1" -f ([guid]::NewGuid().ToString('N')))
try {
    $patched = $source.Replace($old, $new.TrimEnd())
    [System.IO.File]::WriteAllText($temp, $patched, [System.Text.Encoding]::ASCII)

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
