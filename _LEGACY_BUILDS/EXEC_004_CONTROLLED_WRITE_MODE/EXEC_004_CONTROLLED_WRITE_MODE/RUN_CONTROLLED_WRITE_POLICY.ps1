$ErrorActionPreference = "Stop"
$Root = $env:MILES_ROOT
if ([string]::IsNullOrWhiteSpace($Root)) { $Root = "D:\P2GC_Intelligence\MILES_OS" }
Push-Location $Root
try { node .\BUILDER\index.js CONTROLLED_WRITE_POLICY }
finally { Pop-Location }
