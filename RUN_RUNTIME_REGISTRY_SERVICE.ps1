$ErrorActionPreference = "Stop"
$Root = "D:\P2GC_Intelligence\MILES_ENTERPRISE"

Set-Location $Root
node ".\StartRuntimeRegistryService.js"
