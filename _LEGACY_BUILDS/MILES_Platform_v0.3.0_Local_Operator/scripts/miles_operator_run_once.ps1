param(
  [string]$RepoRoot = "D:\P2GC_Intelligence\MILES_OS"
)
$ErrorActionPreference = "Stop"
Set-Location $RepoRoot
$env:MILES_REPO_ROOT = $RepoRoot
python .\miles_operator.py run-once
python .\miles_operator.py report
