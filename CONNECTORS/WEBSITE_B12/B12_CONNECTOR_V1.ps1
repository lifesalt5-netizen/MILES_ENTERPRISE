# MILES Website Connector V1 - B12
# Mode: Observe + Screenshot only
# Does NOT publish
# Does NOT store password

$Root = "D:\P2GC_Intelligence\MILES_OS"
$Screenshots = "$Root\WEBSITE_OPS\WEBSITE_SCREENSHOTS"
$Log = "$Root\MILES_EXECUTION_LOG.csv"

$Timestamp = Get-Date -Format "yyyyMMdd_HHmmss"

Write-Host "MILES B12 Website Connector V1"
Write-Host "Current mode: Observe + Screenshot only"
Write-Host "Do not publish from automation."

# Open B12 dashboard/editor manually if not already open
Start-Process "https://b12.io/dashboard/"

Add-Content $Log "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss'),WEBSITE_B12,Opened B12 dashboard,Success,Manual login required"

Write-Host "B12 opened. Confirm you are logged in, then continue with screenshot/manual audit."
