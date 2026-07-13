$ErrorActionPreference = "Stop"
$Root = "D:\P2GC_Intelligence\MILES_OS"
Set-Location $Root
node .\BUILDER\index.js INSTANTLY_HEALTH
