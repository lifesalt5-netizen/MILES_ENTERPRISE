$Root = "D:\P2GC_Intelligence\MILES_OS"
$Source = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "Installing Google Account Manager..." -ForegroundColor Cyan

New-Item -ItemType Directory -Force -Path "$Root\CONNECTORS\GOOGLE" | Out-Null
New-Item -ItemType Directory -Force -Path "$Root\CONFIG\Credentials\google_accounts" | Out-Null
New-Item -ItemType Directory -Force -Path "$Root\DATA\status" | Out-Null

Copy-Item -Path "$Source\CONNECTORS\GOOGLE\account_manager.js" -Destination "$Root\CONNECTORS\GOOGLE\account_manager.js" -Force
Copy-Item -Path "$Source\CONNECTORS\GOOGLE\workspace.js" -Destination "$Root\CONNECTORS\GOOGLE\workspace.js" -Force
Copy-Item -Path "$Source\CONNECTORS\GOOGLE\index.js" -Destination "$Root\CONNECTORS\GOOGLE\index.js" -Force
Copy-Item -Path "$Source\miles_google_accounts_health.js" -Destination "$Root\miles_google_accounts_health.js" -Force

Write-Host "Google Account Manager installed." -ForegroundColor Green
Write-Host "Next run:" -ForegroundColor Yellow
Write-Host "cd D:\P2GC_Intelligence\MILES_OS"
Write-Host "node CONNECTORS\GOOGLE\account_manager.js add"
