param(
    [Parameter(Mandatory=$true)]
    [string]$Name,

    [string]$Connector = "",

    [string[]]$Dependencies = @(),

    [string[]]$SourceSystems = @()
)

$Root = $env:MILES_ROOT
if ([string]::IsNullOrWhiteSpace($Root)) {
    $Root = "D:\P2GC_Intelligence\MILES_OS"
}

$template = Join-Path $Root "PROVIDERS\providers\MarketingProvider.js"

if (!(Test-Path $template)) {
    Write-Host ""
    Write-Host "MarketingProvider.js not found."
    Write-Host $template
    exit
}

if ($Connector -eq "") {
    $Connector = $Name.ToUpper()
}

if ($Dependencies.Count -eq 0) {
    $Dependencies = @($Name)
}

if ($SourceSystems.Count -eq 0) {
    $SourceSystems = @("CONNECTORS\$Connector")
}

$destination = Join-Path $Root "PROVIDERS\providers\$($Name)Provider.js"

$content = Get-Content $template -Raw

$content = $content.Replace("MarketingProvider","${Name}Provider")
$content = $content.Replace('super("Marketing")',"super(`"$Name`")")
$content = $content.Replace('provider === "Marketing"',"provider === `"$Name`"")

$dependencyBlock = ($Dependencies | ForEach-Object { "            `"$_`"" }) -join ",`r`n"

$sourceBlock = ($SourceSystems | ForEach-Object { "            `"$_`"" }) -join ",`r`n"

$content = [regex]::Replace(
    $content,
    '(?s)this\.dependencies\s*=\s*\[.*?\];',
@"
this.dependencies = [
$dependencyBlock
];
"@
)

$content = [regex]::Replace(
    $content,
    '(?s)this\.sourceSystems\s*=\s*\[.*?\];',
@"
this.sourceSystems = [
$sourceBlock
];
"@
)

$content = $content.Replace("../../CONNECTORS/INSTANTLY/instantly",
"../../CONNECTORS/$Connector/$($Connector.ToLower())")

Set-Content $destination $content -Encoding UTF8

Write-Host ""
Write-Host "========================================"
Write-Host " Provider Generated"
Write-Host "========================================"
Write-Host ""
Write-Host "Provider : $Name"
Write-Host "Connector: $Connector"
Write-Host ""
Write-Host $destination
Write-Host ""