#Requires -Version 5.1

Set-StrictMode -Version Latest
$ErrorActionPreference = "Continue"

$MilesRoot = "D:\P2GC_Intelligence\MILES_ENTERPRISE"
$RuntimeDir = Join-Path $MilesRoot "DATA\runtime"
$OutputFile = Join-Path $RuntimeDir "build100a_infrastructure_audit.json"
$TextReportFile = Join-Path $RuntimeDir "build100a_infrastructure_audit.txt"

New-Item -ItemType Directory -Path $RuntimeDir -Force | Out-Null

function Get-IsoTimestamp {
    return (Get-Date).ToUniversalTime().ToString("o")
}

function Test-CommandAvailable {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Test-PathAccess {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,

        [Parameter(Mandatory = $true)]
        [string]$Label,

        [switch]$TestWrite
    )

    $result = [ordered]@{
        label       = $Label
        path        = $Path
        exists      = $false
        readable    = $false
        writable    = $false
        writeTested = [bool]$TestWrite
        error       = $null
    }

    try {
        $result.exists = Test-Path -LiteralPath $Path

        if (-not $result.exists) {
            return [pscustomobject]$result
        }

        Get-ChildItem -LiteralPath $Path -Force -ErrorAction Stop |
            Select-Object -First 1 |
            Out-Null

        $result.readable = $true
    }
    catch {
        $result.error = $_.Exception.Message
    }

    if ($TestWrite -and $result.exists) {
        $testFile = Join-Path $Path (
            ".miles_access_test_{0}_{1}.tmp" -f $PID, [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        )

        try {
            "MILES BUILD100A access validation" |
                Set-Content -LiteralPath $testFile -Encoding UTF8 -Force -ErrorAction Stop

            if (Test-Path -LiteralPath $testFile) {
                $result.writable = $true
            }
        }
        catch {
            if (-not $result.error) {
                $result.error = $_.Exception.Message
            }
        }
        finally {
            Remove-Item -LiteralPath $testFile -Force -ErrorAction SilentlyContinue
        }
    }

    return [pscustomobject]$result
}

function Get-DriveAudit {
    param(
        [Parameter(Mandatory = $true)]
        [string]$DriveLetter
    )

    $driveName = $DriveLetter.TrimEnd(":")
    $rootPath = "${driveName}:\"

    $result = [ordered]@{
        drive       = "${driveName}:"
        root        = $rootPath
        exists      = $false
        readable    = $false
        writable    = $false
        totalGB     = $null
        freeGB      = $null
        usedPercent = $null
        fileSystem  = $null
        error       = $null
    }

    try {
        $drive = Get-PSDrive -Name $driveName -ErrorAction Stop

        $result.exists = $true
        $result.readable = Test-Path -LiteralPath $rootPath

        if ($drive.Used -ne $null -and $drive.Free -ne $null) {
            $total = [double]$drive.Used + [double]$drive.Free

            $result.totalGB = [math]::Round($total / 1GB, 2)
            $result.freeGB = [math]::Round([double]$drive.Free / 1GB, 2)

            if ($total -gt 0) {
                $result.usedPercent = [math]::Round(
                    ([double]$drive.Used / $total) * 100,
                    2
                )
            }
        }

        try {
            $volume = Get-Volume -DriveLetter $driveName -ErrorAction Stop
            $result.fileSystem = $volume.FileSystem
        }
        catch {}

        $writeTestPath = if ($driveName -eq "D") {
            $RuntimeDir
        }
        else {
            $env:TEMP
        }

        $writeResult = Test-PathAccess `
            -Path $writeTestPath `
            -Label "${driveName}: write test" `
            -TestWrite

        $result.writable = $writeResult.writable

        if ($writeResult.error) {
            $result.error = $writeResult.error
        }
    }
    catch {
        $result.error = $_.Exception.Message
    }

    return [pscustomobject]$result
}

function Get-EnvironmentPresence {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Names
    )

    $results = @()

    foreach ($name in $Names) {
        $value = [Environment]::GetEnvironmentVariable($name)

        if (-not $value) {
            $value = [Environment]::GetEnvironmentVariable(
                $name,
                [EnvironmentVariableTarget]::User
            )
        }

        if (-not $value) {
            $value = [Environment]::GetEnvironmentVariable(
                $name,
                [EnvironmentVariableTarget]::Machine
            )
        }

        $results += [pscustomobject]@{
            name    = $name
            present = -not [string]::IsNullOrWhiteSpace($value)
        }
    }

    return $results
}

function Get-RepositoryFileStatus {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$RelativePaths
    )

    $results = @()

    foreach ($relativePath in $RelativePaths) {
        $fullPath = Join-Path $MilesRoot $relativePath

        $item = [ordered]@{
            relativePath = $relativePath
            fullPath     = $fullPath
            exists       = Test-Path -LiteralPath $fullPath
            sizeBytes    = $null
            modifiedAt   = $null
            syntaxValid  = $null
            syntaxOutput = $null
        }

        if ($item.exists) {
            try {
                $file = Get-Item -LiteralPath $fullPath -ErrorAction Stop
                $item.sizeBytes = $file.Length
                $item.modifiedAt = $file.LastWriteTimeUtc.ToString("o")
            }
            catch {}

            if (
                [IO.Path]::GetExtension($fullPath).ToLowerInvariant() -eq ".js" -and
                (Test-CommandAvailable -Name "node")
            ) {
                try {
                    $syntaxOutput = & node --check $fullPath 2>&1
                    $item.syntaxValid = ($LASTEXITCODE -eq 0)
                    $item.syntaxOutput = ($syntaxOutput | Out-String).Trim()
                }
                catch {
                    $item.syntaxValid = $false
                    $item.syntaxOutput = $_.Exception.Message
                }
            }
        }

        $results += [pscustomobject]$item
    }

    return $results
}

function Invoke-NodeJsonCheck {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,

        [Parameter(Mandatory = $true)]
        [string]$JavaScript
    )

    $result = [ordered]@{
        name       = $Name
        attempted  = $false
        ok         = $false
        durationMs = $null
        output     = $null
        error      = $null
    }

    if (-not (Test-CommandAvailable -Name "node")) {
        $result.error = "Node.js is not available."
        return [pscustomobject]$result
    }

    $result.attempted = $true
    $started = Get-Date

    try {
        Push-Location $MilesRoot

        $output = & node -e $JavaScript 2>&1
        $exitCode = $LASTEXITCODE

        $result.durationMs = [math]::Round(
            ((Get-Date) - $started).TotalMilliseconds,
            2
        )

        $result.output = ($output | Out-String).Trim()
        $result.ok = ($exitCode -eq 0)
    }
    catch {
        $result.error = $_.Exception.Message
    }
    finally {
        Pop-Location
    }

    return [pscustomobject]$result
}

$repositoryFiles = @(
    "SERVICES\ProviderRouterService.js",
    "SERVICES\ExecutionService.js",
    "SERVICES\WorkforceExecutionService.js",
    "SERVICES\LiveBusinessStateService.js",
    "SERVICES\ProviderAuthorityRegistryService.js",
    "SERVICES\ProviderCapabilityBindingService.js",

    "PROVIDERS\providers\MarketingProvider.js",
    "PROVIDERS\providers\OrionProvider.js",
    "PROVIDERS\providers\WebsiteProvider.js",
    "PROVIDERS\providers\SalesProvider.js",
    "PROVIDERS\providers\GoogleWorkspaceProvider.js",

    "CONNECTORS\INSTANTLY\connector.js",
    "CONNECTORS\ORION\connector.js",
    "CONNECTORS\GOOGLE\index.js",
    "CONNECTORS\MILES\connector.js",

    "StartMilesProduction.js",
    "StartProductionSystem.js",
    ".env"
)

$credentialNames = @(
    "INSTANTLY_API_KEY",
    "INSTANTLY_API_TOKEN",
    "INSTANTLY_EMAIL",
    "INSTANTLY_PASSWORD",

    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_REFRESH_TOKEN",
    "GOOGLE_SERVICE_ACCOUNT_FILE",
    "GOOGLE_APPLICATION_CREDENTIALS",

    "NAMECHEAP_API_USER",
    "NAMECHEAP_API_KEY",
    "NAMECHEAP_USERNAME",
    "NAMECHEAP_CLIENT_IP",

    "IONOS_API_KEY",
    "IONOS_API_PREFIX",
    "IONOS_USERNAME",
    "IONOS_PASSWORD",

    "B12_EMAIL",
    "B12_PASSWORD",

    "ORION_DB",
    "ORION_DB_PATH",
    "MILES_ROOT"
)

$importantPaths = @(
    @{
        Path = $MilesRoot
        Label = "MILES Enterprise root"
        Write = $true
    },
    @{
        Path = "D:\P2GC_Intelligence"
        Label = "P2GC Intelligence root"
        Write = $false
    },
    @{
        Path = "D:\P2GC_Intelligence\Good Files to use"
        Label = "Authoritative business data"
        Write = $false
    },
    @{
        Path = "D:\P2GC_Intelligence\Orion Demo 6126"
        Label = "ORION data root"
        Write = $false
    },
    @{
        Path = $RuntimeDir
        Label = "MILES runtime data"
        Write = $true
    },
    @{
        Path = $env:USERPROFILE
        Label = "Windows user profile"
        Write = $false
    },
    @{
        Path = $env:TEMP
        Label = "Windows temporary directory"
        Write = $true
    }
)

$pathAccess = @()

foreach ($entry in $importantPaths) {
    $parameters = @{
        Path = $entry.Path
        Label = $entry.Label
    }

    if ($entry.Write) {
        $parameters.TestWrite = $true
    }

    $pathAccess += Test-PathAccess @parameters
}

$orionHealthScript = @'
const connector = require("./CONNECTORS/ORION/connector");

try {
  const result = connector.healthCheck();
  console.log(JSON.stringify(result));
  if (!result || result.ok === false) process.exitCode = 1;
} finally {
  if (connector && typeof connector.shutdown === "function") {
    connector.shutdown();
  }
}
'@

$providerRouterScript = @'
const router = require("./SERVICES/ProviderRouterService");

(async () => {
  const state =
    typeof router.getPerformanceState === "function"
      ? router.getPerformanceState()
      : router.status();

  console.log(JSON.stringify(state));

  if (typeof router.shutdown === "function") {
    await router.shutdown();
  }
})().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
'@

$liveBusinessStateScript = @'
const Service = require("./SERVICES/LiveBusinessStateService");
const service = new Service();

const files = service.discoverJsonFiles();

console.log(JSON.stringify({
  ok: true,
  discoveredFiles: files.length,
  cache:
    typeof service.getCacheStats === "function"
      ? service.getCacheStats()
      : null
}));
'@

$audit = [ordered]@{
    build = "BUILD100A"
    type = "INFRASTRUCTURE_AUTHORITY_AUDIT"
    generatedAt = Get-IsoTimestamp
    computer = $env:COMPUTERNAME
    user = "$env:USERDOMAIN\$env:USERNAME"
    milesRoot = $MilesRoot

    runtime = [ordered]@{
        powershellVersion = $PSVersionTable.PSVersion.ToString()
        nodeAvailable = Test-CommandAvailable -Name "node"
        npmAvailable = Test-CommandAvailable -Name "npm"
        gitAvailable = Test-CommandAvailable -Name "git"
        pythonAvailable = (
            (Test-CommandAvailable -Name "python") -or
            (Test-CommandAvailable -Name "py")
        )
    }

    drives = @(
        Get-DriveAudit -DriveLetter "C"
        Get-DriveAudit -DriveLetter "D"
    )

    pathAccess = $pathAccess

    credentialPresence = Get-EnvironmentPresence -Names $credentialNames

    repositoryFiles = Get-RepositoryFileStatus -RelativePaths $repositoryFiles

    connectorChecks = @(
        Invoke-NodeJsonCheck `
            -Name "ORION Connector Health" `
            -JavaScript $orionHealthScript

        Invoke-NodeJsonCheck `
            -Name "Provider Router State" `
            -JavaScript $providerRouterScript

        Invoke-NodeJsonCheck `
            -Name "Live Business State Cache" `
            -JavaScript $liveBusinessStateScript
    )
}

$requiredProviderFiles = $audit.repositoryFiles |
    Where-Object {
        $_.relativePath -match "^PROVIDERS\\providers\\"
    }

$requiredConnectorFiles = $audit.repositoryFiles |
    Where-Object {
        $_.relativePath -match "^CONNECTORS\\"
    }

$missingCredentialNames = $audit.credentialPresence |
    Where-Object { -not $_.present } |
    Select-Object -ExpandProperty name

$syntaxFailures = $audit.repositoryFiles |
    Where-Object {
        $_.syntaxValid -eq $false
    } |
    Select-Object -ExpandProperty relativePath

$audit.summary = [ordered]@{
    cDriveReadable = [bool](
        $audit.drives |
        Where-Object { $_.drive -eq "C:" -and $_.readable }
    )

    cDriveWritable = [bool](
        $audit.drives |
        Where-Object { $_.drive -eq "C:" -and $_.writable }
    )

    dDriveReadable = [bool](
        $audit.drives |
        Where-Object { $_.drive -eq "D:" -and $_.readable }
    )

    dDriveWritable = [bool](
        $audit.drives |
        Where-Object { $_.drive -eq "D:" -and $_.writable }
    )

    providerFilesPresent = (
        $requiredProviderFiles |
        Where-Object { $_.exists }
    ).Count

    providerFilesExpected = $requiredProviderFiles.Count

    connectorFilesPresent = (
        $requiredConnectorFiles |
        Where-Object { $_.exists }
    ).Count

    connectorFilesExpected = $requiredConnectorFiles.Count

    missingCredentialCount = $missingCredentialNames.Count
    missingCredentials = @($missingCredentialNames)

    syntaxFailureCount = $syntaxFailures.Count
    syntaxFailures = @($syntaxFailures)

    connectorChecksPassed = (
        $audit.connectorChecks |
        Where-Object { $_.ok }
    ).Count

    connectorChecksAttempted = (
        $audit.connectorChecks |
        Where-Object { $_.attempted }
    ).Count
}

$audit.readyForBuild100B = (
    $audit.summary.dDriveReadable -and
    $audit.summary.dDriveWritable -and
    $audit.runtime.nodeAvailable -and
    $audit.summary.syntaxFailureCount -eq 0
)

$json = $audit | ConvertTo-Json -Depth 20

$json |
    Set-Content -LiteralPath $OutputFile -Encoding UTF8 -Force

$report = @"
MILES ENTERPRISE — BUILD100A INFRASTRUCTURE AUTHORITY AUDIT

Generated: $($audit.generatedAt)
Computer: $($audit.computer)
User: $($audit.user)
MILES Root: $($audit.milesRoot)

DRIVE ACCESS
C: Readable: $($audit.summary.cDriveReadable)
C: Writable Test: $($audit.summary.cDriveWritable)
D: Readable: $($audit.summary.dDriveReadable)
D: Writable Test: $($audit.summary.dDriveWritable)

RUNTIME
Node.js: $($audit.runtime.nodeAvailable)
npm: $($audit.runtime.npmAvailable)
Git: $($audit.runtime.gitAvailable)
Python: $($audit.runtime.pythonAvailable)

MILES SYSTEM FILES
Provider Files: $($audit.summary.providerFilesPresent) / $($audit.summary.providerFilesExpected)
Connector Files: $($audit.summary.connectorFilesPresent) / $($audit.summary.connectorFilesExpected)
Syntax Failures: $($audit.summary.syntaxFailureCount)

CONNECTOR CHECKS
Passed: $($audit.summary.connectorChecksPassed) / $($audit.summary.connectorChecksAttempted)

CREDENTIAL AWARENESS
Missing Credential Variables: $($audit.summary.missingCredentialCount)

READY FOR BUILD100B
$($audit.readyForBuild100B)

JSON Report:
$OutputFile
"@

$report |
    Set-Content -LiteralPath $TextReportFile -Encoding UTF8 -Force

Write-Host ""
Write-Host "========================================================="
Write-Host " MILES BUILD100A INFRASTRUCTURE AUDIT COMPLETE"
Write-Host "========================================================="
Write-Host ""
Write-Host $report
Write-Host ""
Write-Host "Missing credential names:"
$missingCredentialNames | ForEach-Object {
    Write-Host " - $_"
}
Write-Host ""