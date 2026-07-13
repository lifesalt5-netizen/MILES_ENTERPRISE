$Root = "D:\P2GC_Intelligence\MILES_OS"
Write-Host "Installing MILES Core Framework to $Root" -ForegroundColor Cyan

$Source = Split-Path -Parent $MyInvocation.MyCommand.Path

$Folders = @(
    "CORE",
    "DATA\runtime",
    "DATA\status",
    "logs"
)

foreach ($folder in $Folders) {
    $target = Join-Path $Root $folder
    if (!(Test-Path $target)) {
        New-Item -ItemType Directory -Force -Path $target | Out-Null
    }
}

Copy-Item -Path "$Source\CORE\*" -Destination "$Root\CORE" -Recurse -Force
Copy-Item -Path "$Source\CONNECTORS\GOOGLE\index.js" -Destination "$Root\CONNECTORS\GOOGLE\index.js" -Force
Copy-Item -Path "$Source\miles_connector_health.js" -Destination "$Root\miles_connector_health.js" -Force

Write-Host "Core Framework installed." -ForegroundColor Green
Write-Host "Next run:" -ForegroundColor Yellow
Write-Host "cd D:\P2GC_Intelligence\MILES_OS"
Write-Host "node miles_connector_health.js"
