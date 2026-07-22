$ErrorActionPreference = 'Stop'

$Root = 'D:\P2GC_Intelligence\MILES_ENTERPRISE'
$Target = Join-Path $Root 'PROVIDERS\providers\MarketingProvider.js'
$Source = Join-Path $Root 'MarketingProvider_BUILD_052_PATCHED.js'
$Backup = "$Target.BACKUP_$(Get-Date -Format yyyyMMdd_HHmmss)"

Set-Location $Root

if (-not (Test-Path $Source)) {
    throw "Source file not found: $Source"
}

if (-not (Test-Path $Target)) {
    throw "Target file not found: $Target"
}

Write-Host "Checking replacement syntax..."
node --check $Source
if ($LASTEXITCODE -ne 0) { throw 'Replacement syntax check failed.' }

Write-Host "Backing up current provider to: $Backup"
Copy-Item $Target $Backup -Force

Write-Host 'Installing BUILD 052 provider...'
Copy-Item $Source $Target -Force

Write-Host 'Checking installed provider syntax...'
node --check $Target
if ($LASTEXITCODE -ne 0) {
    Write-Host 'Installed file failed syntax check. Restoring backup...'
    Copy-Item $Backup $Target -Force
    throw 'Installation failed and backup was restored.'
}

$match = Select-String -Path $Target -Pattern 'async planMarketingActions\('
if (-not $match) {
    Copy-Item $Backup $Target -Force
    throw 'planMarketingActions was not found after installation. Backup restored.'
}

Write-Host 'BUILD 052 installed successfully.'
Write-Host "Backup: $Backup"
Write-Host "Method found at line: $($match.LineNumber)"
