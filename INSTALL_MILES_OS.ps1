$Target = "D:\P2GC_Intelligence\MILES_OS"

Write-Host "MILES OS v1.0 installer"
Write-Host "Target: $Target"

New-Item -ItemType Directory -Force -Path $Target | Out-Null

Write-Host "Copy the extracted package contents into $Target."
Write-Host "Then run:"
Write-Host "cd $Target\CONNECTORS\WEBSITE_B12"
Write-Host "npm install"
Write-Host "npx playwright install chromium"
Write-Host "node controller.js"
