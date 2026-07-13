param(
  [string]$RepoRoot = "D:\P2GC_Intelligence\MILES_OS"
)

$ErrorActionPreference = "Stop"
Set-Location $RepoRoot
$env:MILES_REPO_ROOT = $RepoRoot

$dirs = @(
  "runtime\operator\inbox",
  "runtime\operator\approved",
  "runtime\operator\running",
  "runtime\operator\completed",
  "runtime\operator\failed",
  "runtime\operator\rejected",
  "runtime\logs",
  "runtime\status"
)
foreach ($d in $dirs) { New-Item -ItemType Directory -Force -Path $d | Out-Null }

python .\miles_operator.py submit --title "Initial local operator health check" --action health_check --module CORE --objective "Validate controlled local operator runtime directories"
python .\miles_operator.py run-once
python .\miles_operator.py report

Write-Host "MILES Local Operator installed and verified."
