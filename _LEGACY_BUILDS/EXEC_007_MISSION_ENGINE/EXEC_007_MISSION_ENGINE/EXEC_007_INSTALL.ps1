param(
  [string]$MilesRoot = "D:\P2GC_Intelligence\Miles_OS"
)

$Target = Join-Path $MilesRoot "EXEC_007_MISSION_ENGINE"
New-Item -ItemType Directory -Force -Path $Target | Out-Null
Copy-Item -Path "$PSScriptRoot\*" -Destination $Target -Recurse -Force
Write-Host "EXEC_007 Mission Automation Engine installed to $Target"
Write-Host "Next: wire MISSION_ENGINE.ts to existing EXEC_005 Business Execution Engine adapter."
