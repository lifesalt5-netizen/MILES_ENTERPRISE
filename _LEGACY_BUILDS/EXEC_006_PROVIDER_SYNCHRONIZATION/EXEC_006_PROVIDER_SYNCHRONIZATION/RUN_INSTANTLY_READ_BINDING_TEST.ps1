$ErrorActionPreference = "Stop"
$Root = $env:MILES_ROOT
if ([string]::IsNullOrWhiteSpace($Root)) { $Root = "D:\P2GC_Intelligence\MILES_OS" }
Write-Host ""
Write-Host "========================================"
Write-Host " EXEC_006 Instantly Read Binding Test"
Write-Host "========================================"
Write-Host "Root: $Root"
Push-Location $Root
try {
    node -e "(async()=>{const i=require('./SERVICES/InstantlyProviderCompatibilityService'); const r=await i.listCampaigns({limit:3}); console.log(JSON.stringify(r,null,2)); if(!r.ok) process.exit(1);})().catch(e=>{console.error(e.stack||e.message);process.exit(1);})"
}
finally { Pop-Location }
