param(
    [string]$MilesRoot = "D:\P2GC_Intelligence\MILES_ENTERPRISE"
)

$ErrorActionPreference = "Stop"

function Step([string]$Text) {
    Write-Host ""
    Write-Host "============================================================" -ForegroundColor DarkCyan
    Write-Host $Text -ForegroundColor Cyan
    Write-Host "============================================================" -ForegroundColor DarkCyan
}

if (-not (Test-Path $MilesRoot)) {
    throw "MILES root not found: $MilesRoot"
}

$sourceFile = Join-Path $PSScriptRoot "WorkQueueService.js"
$targetFile = Join-Path $MilesRoot "SERVICES\WorkQueueService.js"
$queueFile = Join-Path $MilesRoot "DATA\runtime\work_queue.json"
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backupDir = Join-Path $MilesRoot "runtime\workqueue_final_backup_$stamp"

if (-not (Test-Path $sourceFile)) {
    throw "WorkQueueService.js must be in the same folder as this installer."
}

Set-Location $MilesRoot
$env:MILES_ROOT = $MilesRoot

Step "1. STOPPING MILES"
Get-Process node -ErrorAction SilentlyContinue |
    Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

Step "2. BACKING UP CURRENT FILES"
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
Copy-Item -Force $targetFile (Join-Path $backupDir "WorkQueueService.js")

if (Test-Path $queueFile) {
    Copy-Item -Force $queueFile (Join-Path $backupDir "work_queue.json")
}

Write-Host "Backup: $backupDir" -ForegroundColor Green

Step "3. INSTALLING COMPLETE REPLACEMENT"
Copy-Item -Force $sourceFile $targetFile
Write-Host "Installed: $targetFile" -ForegroundColor Green

Step "4. VALIDATING JAVASCRIPT"
& node --check $targetFile

if ($LASTEXITCODE -ne 0) {
    Copy-Item -Force (Join-Path $backupDir "WorkQueueService.js") $targetFile
    throw "Syntax validation failed. Original file restored."
}

Write-Host "Syntax passed." -ForegroundColor Green

Step "5. MIGRATING AND RECLASSIFYING EXISTING WORK"
& node -e "const W=require('./SERVICES/WorkQueueService'); const q=new W(); const items=q.getAll().filter(x=>/WebsiteProviderLoadFailure|Repair Website|WebsiteProvider/i.test([x.area,x.title,x.description,x.metadata?.type,x.metadata?.exception?.type,x.metadata?.repair?.type].filter(Boolean).join(' '))); console.log('Website items:',JSON.stringify(items.map(x=>({id:x.id,title:x.title,status:x.status,requiresKevin:x.requiresKevin,executionType:x.executionType})),null,2)); console.log('Stats:',JSON.stringify(q.getStats(),null,2)); if(items.some(x=>x.requiresKevin===true||x.executionType==='APPROVAL_REQUIRED')) process.exit(2);"

if ($LASTEXITCODE -ne 0) {
    Copy-Item -Force (Join-Path $backupDir "WorkQueueService.js") $targetFile
    if (Test-Path (Join-Path $backupDir "work_queue.json")) {
        Copy-Item -Force (Join-Path $backupDir "work_queue.json") $queueFile
    }
    throw "Governance migration failed. Original files restored."
}

Step "6. RUNNING AUTONOMOUS COO CYCLE"
$cycle = & node ".\StartAutonomousCOO.js" 2>&1
$cycle | ForEach-Object { Write-Host $_ }

if ($LASTEXITCODE -ne 0) {
    throw "Autonomous COO cycle failed."
}

Step "7. STARTING MILES PRODUCTION"
$stdout = Join-Path $MilesRoot "runtime\WorkQueueFinal_$stamp.stdout.log"
$stderr = Join-Path $MilesRoot "runtime\WorkQueueFinal_$stamp.stderr.log"

$process = Start-Process `
    -FilePath "node" `
    -ArgumentList @("StartMilesProduction.js") `
    -WorkingDirectory $MilesRoot `
    -RedirectStandardOutput $stdout `
    -RedirectStandardError $stderr `
    -PassThru

Start-Sleep -Seconds 15

if ($process.HasExited) {
    if (Test-Path $stdout) { Get-Content $stdout -Tail 100 }
    if (Test-Path $stderr) { Get-Content $stderr -Tail 100 }
    throw "MILES exited during startup."
}

Step "COMPLETE — MILES IS RUNNING"
Write-Host "Production PID: $($process.Id)" -ForegroundColor Green
Write-Host "Backup: $backupDir"
Write-Host "Output log: $stdout"
Write-Host "Error log: $stderr"
