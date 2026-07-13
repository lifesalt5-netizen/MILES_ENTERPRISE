param(
  [string]$RepoRoot = "D:\P2GC_Intelligence\MILES_OS",
  [switch]$ApplyArchive
)

$ErrorActionPreference = "Stop"

function Write-Info($msg) { Write-Host "[MILES] $msg" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "[OK] $msg" -ForegroundColor Green }
function Write-Warn2($msg) { Write-Host "[WARN] $msg" -ForegroundColor Yellow }

if (!(Test-Path $RepoRoot)) { throw "Repo root not found: $RepoRoot" }
Set-Location $RepoRoot

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backupRoot = Join-Path $RepoRoot "_backups\fixall_$timestamp"
New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
Write-Info "Backup folder: $backupRoot"

# Back up key root files before changes.
$keyFiles = @(".gitignore", ".env", "START_MILES.ps1", "MILES_BOOTSTRAP.ps1", "MILES_RUNTIME_LOOP.ps1", "package.json")
foreach ($f in $keyFiles) {
  if (Test-Path $f) { Copy-Item $f (Join-Path $backupRoot $f.Replace("\", "_")) -Force }
}

# 1) Harden .gitignore without deleting existing rules.
$gitignorePath = Join-Path $RepoRoot ".gitignore"
$requiredIgnore = @(
  "",
  "# MILES security and generated files",
  ".env",
  ".env.*",
  "!/.env.example",
  "CONFIG/Credentials/",
  "**/CONFIG/Credentials/",
  "**/google_token.json",
  "**/google_oauth_client.json",
  "node_modules/",
  "**/node_modules/",
  "*.log",
  "*.zip",
  "_backups/",
  "_archive/",
  "releases/",
  "DATA/status/",
  "output/",
  "reports/",
  "status/"
)
if (!(Test-Path $gitignorePath)) { New-Item -ItemType File -Path $gitignorePath | Out-Null }
$currentIgnore = Get-Content $gitignorePath -Raw
foreach ($line in $requiredIgnore) {
  if ($line -eq "") { continue }
  if ($currentIgnore -notmatch [regex]::Escape($line)) { Add-Content -Path $gitignorePath -Value $line }
}
Write-Ok ".gitignore hardened"

# 2) Create .env.example without secrets.
$envExample = @'
GOOGLE_OAUTH_CLIENT=D:\P2GC_Intelligence\MILES_OS\CONFIG\Credentials\google_oauth_client.json
ORION_DB=D:\P2GC_Intelligence\Orion Demo 6126\orion_live_demo_ready\ORION_DEMO_LIVE_READY.db
INSTANTLY_API_KEY=replace_with_instantly_api_key
NAMECHEAP_API_KEY=
IONOS_USERNAME=
IONOS_PASSWORD=
LINKEDIN_CLIENT_ID=
LINKEDIN_CLIENT_SECRET=
'@
Set-Content -Path (Join-Path $RepoRoot ".env.example") -Value $envExample -Encoding UTF8
Write-Ok ".env.example created"

# 3) Patch ORION_DB in .env only if blank and default DB exists.
$defaultOrionDb = "D:\P2GC_Intelligence\Orion Demo 6126\orion_live_demo_ready\ORION_DEMO_LIVE_READY.db"
$envPath = Join-Path $RepoRoot ".env"
if (Test-Path $envPath) {
  $envText = Get-Content $envPath -Raw
  if (($envText -match "(?m)^ORION_DB=\s*$") -and (Test-Path $defaultOrionDb)) {
    $envText = $envText -replace "(?m)^ORION_DB=\s*$", "ORION_DB=$defaultOrionDb"
    Set-Content -Path $envPath -Value $envText -Encoding UTF8
    Write-Ok "ORION_DB populated in .env"
  } elseif ($envText -match "(?m)^ORION_DB=\s*$") {
    Write-Warn2 "ORION_DB is blank and default DB was not found. Set it manually in .env."
  } else {
    Write-Ok "ORION_DB already set"
  }
} else {
  Copy-Item (Join-Path $RepoRoot ".env.example") $envPath
  Write-Warn2 ".env was missing; created from .env.example. Add real secrets manually."
}

# 4) Ensure scripts folder exists.
$scriptsDir = Join-Path $RepoRoot "scripts"
New-Item -ItemType Directory -Force -Path $scriptsDir | Out-Null

# 5) Repo doctor script.
$repoDoctor = @'
param([string]$RepoRoot = "D:\P2GC_Intelligence\MILES_OS")
$ErrorActionPreference = "Stop"
Set-Location $RepoRoot
Write-Host "===================================="
Write-Host "MILES REPO DOCTOR"
Write-Host "===================================="
Write-Host "Repo: $RepoRoot"
Write-Host "Generated: $(Get-Date)"
Write-Host ""

$required = @("CORE","CONNECTORS","CONFIG","OPERATOR","masters","governance","inventory","WEBSITE_OPS")
foreach ($d in $required) {
  if (Test-Path $d) { Write-Host "OK   folder $d" -ForegroundColor Green }
  else { Write-Host "MISS folder $d" -ForegroundColor Red }
}

Write-Host ""
Write-Host "Legacy/drop folders present:"
$legacy = @("Drop in","MILES_OS_v1","miles_core_framework_dropin","miles_instantly_connector","MILES_Platform_v0.3.0_Local_Operator","MILES_Automation_FastTrack_v0.4.0")
foreach ($d in $legacy) {
  if (Test-Path $d) { Write-Host "WARN $d" -ForegroundColor Yellow }
}

Write-Host ""
Write-Host "Runtime files:"
$runtime = @("MILES_TASK_QUEUE.csv","MILES_EXECUTION_LOG.csv","MILES_SYSTEM_STATUS.csv","MILES_DASHBOARD.csv","MILES_WORK_REGISTRY.csv","MILES_PRIORITY_RULES.csv")
foreach ($f in $runtime) {
  if (Test-Path $f) { Write-Host "OK   $f" -ForegroundColor Green }
  else { Write-Host "MISS $f" -ForegroundColor Red }
}

Write-Host ""
Write-Host "Secrets check:"
if (Test-Path ".env") { Write-Host "WARN .env exists locally. Must not be committed." -ForegroundColor Yellow }
if (Test-Path "CONFIG\Credentials") { Write-Host "WARN CONFIG\Credentials exists locally. Must not be committed." -ForegroundColor Yellow }

Write-Host ""
Write-Host "Git tracked sensitive files, if any:"
try {
  $tracked = git ls-files 2>$null
  $bad = $tracked | Where-Object { $_ -match "(^|/)\.env$|CONFIG/Credentials|google_token\.json|google_oauth_client\.json" }
  if ($bad) { $bad | ForEach-Object { Write-Host "TRACKED_SECRET $_" -ForegroundColor Red } }
  else { Write-Host "OK no obvious tracked secrets" -ForegroundColor Green }
} catch { Write-Host "Git unavailable or not initialized." -ForegroundColor Yellow }

Write-Host ""
Write-Host "Recommended next command: .\scripts\START_MILES_AUTOMATION.ps1"
'@
Set-Content -Path (Join-Path $scriptsDir "MILES_REPO_DOCTOR.ps1") -Value $repoDoctor -Encoding UTF8
Write-Ok "scripts/MILES_REPO_DOCTOR.ps1 created"

# 6) Start automation wrapper that uses existing files only.
$startAutomation = @'
param([string]$RepoRoot = "D:\P2GC_Intelligence\MILES_OS")
$ErrorActionPreference = "Continue"
Set-Location $RepoRoot
Write-Host "===================================="
Write-Host "MILES AUTOMATION START"
Write-Host "===================================="

function Run-Step($Name, $ScriptBlock) {
  Write-Host ""
  Write-Host "--- $Name ---" -ForegroundColor Cyan
  try { & $ScriptBlock; Write-Host "OK: $Name" -ForegroundColor Green }
  catch { Write-Host "FAIL: $Name :: $($_.Exception.Message)" -ForegroundColor Red }
}

Run-Step "Bootstrap" { if (Test-Path ".\START_MILES.ps1") { .\START_MILES.ps1 } elseif (Test-Path ".\MILES_BOOTSTRAP.ps1") { .\MILES_BOOTSTRAP.ps1 } else { throw "No startup script found" } }
Run-Step "Connector Health" { if (Test-Path ".\miles_connector_health.js") { node .\miles_connector_health.js } else { Write-Host "Skipped; miles_connector_health.js not found" } }
Run-Step "Google Health" { if (Test-Path ".\miles_google_accounts_health.js") { node .\miles_google_accounts_health.js } else { Write-Host "Skipped; miles_google_accounts_health.js not found" } }
Run-Step "Executive Dashboard" { if (Test-Path ".\executive_dashboard.js") { node .\executive_dashboard.js } else { Write-Host "Skipped; executive_dashboard.js not found" } }
Run-Step "Runtime Loop" { if (Test-Path ".\MILES_RUNTIME_LOOP.ps1") { .\MILES_RUNTIME_LOOP.ps1 } else { Write-Host "Skipped; MILES_RUNTIME_LOOP.ps1 not found" } }

Write-Host ""
Write-Host "MILES automation run complete."
'@
Set-Content -Path (Join-Path $scriptsDir "START_MILES_AUTOMATION.ps1") -Value $startAutomation -Encoding UTF8
Write-Ok "scripts/START_MILES_AUTOMATION.ps1 created"

# 7) Security cleanup helper.
$securityCleanup = @'
param([string]$RepoRoot = "D:\P2GC_Intelligence\MILES_OS")
Set-Location $RepoRoot
Write-Host "MILES SECURITY CLEANUP"
Write-Host "This removes sensitive files from Git tracking only. It does not delete local files."
$patterns = @(".env", "CONFIG/Credentials/google_token.json", "CONFIG/Credentials/google_oauth_client.json")
foreach ($p in $patterns) {
  try { git rm --cached --ignore-unmatch $p 2>$null | Out-Null; Write-Host "Untracked from Git cache: $p" -ForegroundColor Green }
  catch { Write-Host "Skipped: $p" -ForegroundColor Yellow }
}
Write-Host "IMPORTANT: Rotate any API keys that were uploaded, pasted, emailed, or committed."
'@
Set-Content -Path (Join-Path $scriptsDir "SECURITY_CLEANUP.ps1") -Value $securityCleanup -Encoding UTF8
Write-Ok "scripts/SECURITY_CLEANUP.ps1 created"

# 8) Archive plan: safe, no automatic moving unless requested.
$archiveDir = Join-Path $RepoRoot "_archive\legacy_drops_$timestamp"
$legacyCandidates = @("Drop in","miles_core_framework_dropin","miles_instantly_connector","MILES_Platform_v0.3.0_Local_Operator","MILES_Automation_FastTrack_v0.4.0")
$archivePlanPath = Join-Path $RepoRoot "MILES_ARCHIVE_PLAN_$timestamp.txt"
$archivePlan = @()
$archivePlan += "MILES Archive Plan - $timestamp"
$archivePlan += "These are legacy/drop folders that should not be production roots. Review before moving."
foreach ($d in $legacyCandidates) { if (Test-Path $d) { $archivePlan += $d } }
Set-Content -Path $archivePlanPath -Value ($archivePlan -join [Environment]::NewLine) -Encoding UTF8
Write-Ok "Archive plan created: $archivePlanPath"

if ($ApplyArchive) {
  New-Item -ItemType Directory -Force -Path $archiveDir | Out-Null
  foreach ($d in $legacyCandidates) {
    if (Test-Path $d) { Move-Item $d $archiveDir -Force; Write-Ok "Archived $d" }
  }
} else {
  Write-Warn2 "Legacy folders were NOT moved. Re-run with -ApplyArchive after review."
}

# 9) Write next actions.
$next = @'
# MILES Fix-All Applied

Production root remains:
D:\P2GC_Intelligence\MILES_OS

Run these next:

```powershell
cd D:\P2GC_Intelligence\MILES_OS
.\scripts\MILES_REPO_DOCTOR.ps1
.\scripts\SECURITY_CLEANUP.ps1
.\scripts\START_MILES_AUTOMATION.ps1
```

Security note:
If any API key was uploaded, pasted, or committed, rotate it in the source system and update local .env.

Do not build inside legacy/drop folders. Production work should target the root repo folders only.
'@
Set-Content -Path (Join-Path $RepoRoot "MILES_NEXT_ACTIONS.md") -Value $next -Encoding UTF8
Write-Ok "MILES_NEXT_ACTIONS.md written"

Write-Host ""
Write-Host "====================================" -ForegroundColor Cyan
Write-Host "MILES FIX-ALL COMPLETE" -ForegroundColor Cyan
Write-Host "====================================" -ForegroundColor Cyan
Write-Host "Next commands:" -ForegroundColor White
Write-Host "cd $RepoRoot"
Write-Host ".\scripts\MILES_REPO_DOCTOR.ps1"
Write-Host ".\scripts\SECURITY_CLEANUP.ps1"
Write-Host ".\scripts\START_MILES_AUTOMATION.ps1"
