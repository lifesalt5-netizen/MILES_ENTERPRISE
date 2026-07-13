$Root = "D:\P2GC_Intelligence\MILES_OS\MILES_OS_v1"
$Src = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "Installing MILES Google Connector..." -ForegroundColor Cyan
Copy-Item -Path "$Src\CONNECTORS\GOOGLE\*" -Destination "$Root\CONNECTORS\GOOGLE" -Recurse -Force
Write-Host "Installed to $Root\CONNECTORS\GOOGLE" -ForegroundColor Green
Write-Host "Next run:" -ForegroundColor Yellow
Write-Host "cd $Root"
Write-Host "node CONNECTORS\GOOGLE\auth.js"
