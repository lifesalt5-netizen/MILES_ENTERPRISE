$Root = $env:MILES_ROOT
if ([string]::IsNullOrWhiteSpace($Root)) { $Root = "D:\P2GC_Intelligence\MILES_OS" }
Push-Location $Root
node .\BUILDER\index.js PROVIDER_CONTROLLER_HEALTH
Pop-Location
