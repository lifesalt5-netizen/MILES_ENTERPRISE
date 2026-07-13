param(
    [string]$Root = "D:\P2GC_Intelligence\MILES_ENTERPRISE"
)

$ErrorActionPreference = "Stop"
Clear-Host

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "       MILES REGISTRY CONVERGENCE INSPECTOR v1.0" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path -LiteralPath $Root)) {
    Write-Host "MILES root not found: $Root" -ForegroundColor Red
    Read-Host "Press Enter to close"
    exit 1
}

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$outDir = Join-Path $Root "_REGISTRY_CONVERGENCE_$stamp"
$zipPath = "$outDir.zip"
New-Item -ItemType Directory -Path $outDir -Force | Out-Null

$targets = @(
    "StartMilesProduction.js",
    "StartProductionSystem.js",
    "StartAutonomousCOO.js",
    "SERVICES\StartProductionSystem.js",
    "SERVICES\EnterpriseRuntimeManager.js",
    "SERVICES\WorkerRegistry.js",
    "SERVICES\CapabilityRegistry.js",
    "SERVICES\CapabilityRegistryService.js",
    "SERVICES\RepositoryRegistryService.js",
    "SERVICES\ProviderRegistryService.js",
    "SERVICES\ProviderAuthorityRegistryService.js",
    "SERVICES\ProviderControllerRegistryService.js",
    "SERVICES\worker_runtime\WorkerRuntime.js",
    "SERVICES\worker_runtime\WorkerRuntimeManager.js",
    "SERVICES\worker_runtime\WorkerRegistry.js",
    "SERVICES\Planning\PlannerRegistry.js",
    "SERVICES\digital_coo\DigitalCOORuntimeManager.js",
    "SERVICES\digital_coo\MilesCommandCenter.js",
    "CORE\Kernel\ServiceRegistry.js",
    "CORE\DepartmentRegistry.js",
    "CORE\CANONICAL\Registry.js",
    "PROVIDERS\ProviderRegistry.js",
    "PROVIDERS\registry\ProviderRegistry.js",
    "BuildEnterpriseRegistry.js",
    "RUN_ENTERPRISE_REGISTRY.ps1",
    "runtime\enterprise_registry\component_registry_summary.json",
    "runtime\enterprise_registry\component_registry_changes.json",
    "runtime\enterprise_registry\capability_registry_summary.json",
    "runtime\enterprise_registry\capability_routing_table.json"
)

$manifest = New-Object System.Collections.Generic.List[object]

foreach ($relative in $targets) {
    $source = Join-Path $Root $relative
    if (Test-Path -LiteralPath $source) {
        $destination = Join-Path $outDir $relative
        $destinationParent = Split-Path $destination -Parent
        New-Item -ItemType Directory -Path $destinationParent -Force | Out-Null
        Copy-Item -LiteralPath $source -Destination $destination -Force

        $item = Get-Item -LiteralPath $source
        $manifest.Add([pscustomobject]@{
            RelativePath = $relative
            Exists = $true
            SizeBytes = $item.Length
            ModifiedUtc = $item.LastWriteTimeUtc.ToString("o")
        })
        Write-Host "[FOUND] $relative" -ForegroundColor Green
    }
    else {
        $manifest.Add([pscustomobject]@{
            RelativePath = $relative
            Exists = $false
            SizeBytes = 0
            ModifiedUtc = ""
        })
        Write-Host "[MISS ] $relative" -ForegroundColor DarkYellow
    }
}

$registryPatterns = @(
    "*Registry*.js",
    "*RuntimeManager*.js",
    "*WorkerRuntime*.js"
)

$discovered = New-Object System.Collections.Generic.List[object]

foreach ($pattern in $registryPatterns) {
    Get-ChildItem -LiteralPath $Root -Recurse -File -Filter $pattern -ErrorAction SilentlyContinue |
        Where-Object {
            $_.FullName -notmatch "\\node_modules\\" -and
            $_.FullName -notmatch "\\.git\\" -and
            $_.FullName -notmatch "\\_LEGACY_BUILDS\\" -and
            $_.FullName -notmatch "\\_REFERENCE\\" -and
            $_.FullName -notmatch "\\_REGISTRY_CONVERGENCE_"
        } |
        ForEach-Object {
            $relative = $_.FullName.Substring($Root.Length).TrimStart("\")
            $discovered.Add([pscustomobject]@{
                RelativePath = $relative
                Name = $_.Name
                SizeBytes = $_.Length
                ModifiedUtc = $_.LastWriteTimeUtc.ToString("o")
            })
        }
}

$manifest | Export-Csv (Join-Path $outDir "TARGET_MANIFEST.csv") -NoTypeInformation -Encoding UTF8
$discovered |
    Sort-Object RelativePath -Unique |
    Export-Csv (Join-Path $outDir "DISCOVERED_ACTIVE_REGISTRIES.csv") -NoTypeInformation -Encoding UTF8

@"
MILES REGISTRY CONVERGENCE INSPECTION
Generated: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
Root: $Root

Purpose:
Determine which existing MILES registries and runtime managers are authoritative
before adding runtime self-registration. This prevents duplicate registries,
conflicting routing, and parallel sources of truth.

No credentials, environment files, databases, or customer data are included.
"@ | Set-Content (Join-Path $outDir "README.txt") -Encoding UTF8

if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Compress-Archive -Path (Join-Path $outDir "*") -DestinationPath $zipPath -CompressionLevel Optimal

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "INSPECTION PACKAGE READY" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host $zipPath -ForegroundColor Yellow
Start-Process explorer.exe "/select,`"$zipPath`""
Write-Host ""
Read-Host "Press Enter to close"
