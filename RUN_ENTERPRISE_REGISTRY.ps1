$ErrorActionPreference = "Stop"
$Root = "D:\P2GC_Intelligence\MILES_ENTERPRISE"
Push-Location $Root
try {
    node ".\BuildEnterpriseRegistry.js"
}
finally {
    Pop-Location
}
