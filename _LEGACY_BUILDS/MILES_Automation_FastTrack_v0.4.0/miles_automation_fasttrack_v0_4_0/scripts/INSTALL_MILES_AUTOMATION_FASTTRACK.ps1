param(
    [string]$RepoRoot = "D:\P2GC_Intelligence\MILES_OS",
    [switch]$NoBackup
)

$ErrorActionPreference = "Stop"
$SourceRoot = Split-Path -Parent $PSScriptRoot

if (!(Test-Path $RepoRoot)) { throw "RepoRoot does not exist: $RepoRoot" }

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backupRoot = Join-Path $RepoRoot "releases\backups\automation_fasttrack_$timestamp"
if (!$NoBackup) {
    New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
    foreach ($item in @("CORE\autonomous_work_engine.js","CORE\authority_gate.js","CORE\csv_utils.js","CONFIG\MILES_CAPABILITY_REGISTRY.csv","EXECUTIVE\status_report.js")) {
        $target = Join-Path $RepoRoot $item
        if (Test-Path $target) {
            $backupTarget = Join-Path $backupRoot $item
            New-Item -ItemType Directory -Force -Path (Split-Path $backupTarget -Parent) | Out-Null
            Copy-Item $target $backupTarget -Force
        }
    }
}

foreach ($folder in @("CORE","CONFIG","EXECUTIVE","scripts","docs","reports","tasks","logs","status","releases")) {
    New-Item -ItemType Directory -Force -Path (Join-Path $RepoRoot $folder) | Out-Null
}

Copy-Item (Join-Path $SourceRoot "CORE\*") (Join-Path $RepoRoot "CORE") -Force
Copy-Item (Join-Path $SourceRoot "CONFIG\*") (Join-Path $RepoRoot "CONFIG") -Force
Copy-Item (Join-Path $SourceRoot "EXECUTIVE\*") (Join-Path $RepoRoot "EXECUTIVE") -Force
Copy-Item (Join-Path $SourceRoot "scripts\RUN_MILES_AUTOMATION_FASTTRACK.ps1") (Join-Path $RepoRoot "scripts") -Force
Copy-Item (Join-Path $SourceRoot "docs\MILES_AUTOMATION_FASTTRACK_v0.4.0.md") (Join-Path $RepoRoot "docs") -Force

Write-Host "Installed MILES Automation FastTrack v0.4.0 into $RepoRoot" -ForegroundColor Green
Write-Host "Run: .\scripts\RUN_MILES_AUTOMATION_FASTTRACK.ps1 -RepoRoot `"$RepoRoot`""
