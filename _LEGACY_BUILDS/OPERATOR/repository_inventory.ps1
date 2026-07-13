###############################################################################
# MILES OS
#
# File: repository_inventory.ps1
# Version: 2.0.0
# Build: BUILD_039_REPOSITORY_INTELLIGENCE
# Updated: 2026-07-04
#
# Purpose:
#   Read-only repository intelligence scanner for P2GC / MILES consolidation.
#
# Safety:
#   This script does not delete, move, rename, overwrite, or modify any scanned
#   project files. It only creates reports in the output folder.
#
# Default Root:
#   D:\P2GC_Intelligence
#
# Default Output:
#   D:\P2GC_Intelligence\MILES_OS\reports\repository_consolidation
###############################################################################

param(
    [string]$Root = "D:\P2GC_Intelligence",
    [string]$OutputDir = "D:\P2GC_Intelligence\MILES_OS\reports\repository_consolidation",
    [switch]$HashFiles,
    [int]$MaxHashFileMB = 50
)

$ErrorActionPreference = "Continue"

function Write-Status {
    param([string]$Message)
    Write-Host "[MILES] $Message"
}

function Ensure-Directory {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) {
        New-Item -ItemType Directory -Force -Path $Path | Out-Null
    }
}

function Safe-TestPath {
    param([string]$Path)
    try {
        return Test-Path -LiteralPath $Path
    }
    catch {
        return $false
    }
}

function Get-SafeChildItems {
    param(
        [string]$Path,
        [switch]$Recurse,
        [switch]$FilesOnly,
        [switch]$DirectoriesOnly
    )

    try {
        if ($FilesOnly) {
            return Get-ChildItem -LiteralPath $Path -Force -File -Recurse:$Recurse -ErrorAction SilentlyContinue
        }

        if ($DirectoriesOnly) {
            return Get-ChildItem -LiteralPath $Path -Force -Directory -Recurse:$Recurse -ErrorAction SilentlyContinue
        }

        return Get-ChildItem -LiteralPath $Path -Force -Recurse:$Recurse -ErrorAction SilentlyContinue
    }
    catch {
        return @()
    }
}

function Get-FolderSizeMB {
    param([string]$Path)

    try {
        $sum = Get-ChildItem -LiteralPath $Path -Recurse -Force -File -ErrorAction SilentlyContinue |
            Measure-Object -Property Length -Sum

        if ($null -eq $sum.Sum) {
            return 0
        }

        return [math]::Round($sum.Sum / 1MB, 2)
    }
    catch {
        return -1
    }
}

function Get-FolderFileCount {
    param([string]$Path)

    try {
        return (Get-ChildItem -LiteralPath $Path -Recurse -Force -File -ErrorAction SilentlyContinue | Measure-Object).Count
    }
    catch {
        return -1
    }
}

function Get-ProjectFlags {
    param([string]$Path)

    $packageJson = Safe-TestPath (Join-Path $Path "package.json")
    $nodeModules = Safe-TestPath (Join-Path $Path "node_modules")
    $requirements = Safe-TestPath (Join-Path $Path "requirements.txt")
    $pyproject = Safe-TestPath (Join-Path $Path "pyproject.toml")
    $venv = Safe-TestPath (Join-Path $Path "venv")
    $dotVenv = Safe-TestPath (Join-Path $Path ".venv")
    $git = Safe-TestPath (Join-Path $Path ".git")
    $psScripts = (Get-SafeChildItems -Path $Path -FilesOnly | Where-Object { $_.Extension -eq ".ps1" } | Measure-Object).Count

    return [PSCustomObject]@{
        HasPackageJson = $packageJson
        HasNodeModules = $nodeModules
        HasPythonProject = ($requirements -or $pyproject)
        HasPythonVenv = ($venv -or $dotVenv)
        HasGit = $git
        PowerShellScriptCount = $psScripts
    }
}

function Normalize-DuplicateKey {
    param([string]$Name)

    $key = $Name.ToLowerInvariant()
    $key = $key -replace "\(\d+\)$", ""
    $key = $key -replace "_v\d+.*$", ""
    $key = $key -replace "-v\d+.*$", ""
    $key = $key -replace "_copy.*$", ""
    $key = $key -replace " copy.*$", ""
    $key = $key -replace "_repository_integrated.*$", ""
    $key = $key -replace "_coo_repository_intelligence.*$", ""
    $key = $key -replace "_production_integration.*$", ""
    $key = $key -replace "_credential_vault.*$", ""
    $key = $key.Trim()
    return $key
}

function Classify-Folder {
    param(
        [string]$Name,
        [string]$FullPath
    )

    $lower = $Name.ToLowerInvariant()
    $fullLower = $FullPath.ToLowerInvariant()

    if ($lower -eq "miles_os") {
        return @("KEEP", "Primary production MILES repository candidate")
    }

    if ($lower -eq "orion" -or $lower -like "orion*") {
        return @("KEEP", "ORION intelligence assets require manual review before any archive")
    }

    if ($lower -in @("clients", "client_files", "crm", "live_pipeline", "sam_registry", "usa_spending", "sled", "datasets", "good files to use")) {
        return @("KEEP", "Active operational or business data area")
    }

    if ($lower -like "build_*" -or $lower -like "exec_*" -or $lower -like "int_*") {
        return @("ARCHIVE_CANDIDATE", "Historical build or execution package naming pattern")
    }

    if ($lower -like "*patch*" -or $lower -like "*backup*" -or $lower -like "*recovered*" -or $lower -like "*old*") {
        return @("ARCHIVE_CANDIDATE", "Historical patch, backup, recovered, or old folder naming pattern")
    }

    if ($fullLower -match "repository_integrated|repository_intelligence|credential_vault|production_integration|consolidation_kit") {
        return @("MERGE_OR_ARCHIVE", "Generated integration or consolidation package; compare before archiving")
    }

    if ($lower -eq "node_modules") {
        return @("DELETE_CANDIDATE_REVIEW_ONLY", "Regenerable dependency folder, only if parent project is inactive")
    }

    if ($lower -eq ".venv" -or $lower -eq "venv" -or $lower -eq "__pycache__") {
        return @("DELETE_CANDIDATE_REVIEW_ONLY", "Regenerable Python environment/cache folder, only if inactive")
    }

    return @("REVIEW", "No automatic classification rule matched")
}

function Classify-File {
    param([System.IO.FileInfo]$File)

    $name = $File.Name.ToLowerInvariant()
    $ext = $File.Extension.ToLowerInvariant()

    if ($ext -eq ".db" -or $ext -eq ".sqlite" -or $ext -eq ".sqlite3" -or $ext -eq ".accdb" -or $ext -eq ".mdb") {
        return @("PROTECT", "Database file")
    }

    if ($ext -eq ".xlsx" -or $ext -eq ".xls" -or $ext -eq ".csv") {
        return @("DATA_ASSET", "Spreadsheet or CSV data asset")
    }

    if ($ext -eq ".zip" -or $ext -eq ".7z" -or $ext -eq ".rar") {
        return @("ARCHIVE_ARTIFACT", "Compressed archive")
    }

    if ($name -match "credential|secret|token|api|key|password|oauth") {
        return @("PROTECT", "Possible credential or secret file")
    }

    if ($ext -eq ".ps1" -or $ext -eq ".js" -or $ext -eq ".ts" -or $ext -eq ".py") {
        return @("SOURCE_CODE", "Source or script file")
    }

    return @("GENERAL", "General file")
}

function Get-FileHashSafe {
    param(
        [string]$Path,
        [int]$MaxMB
    )

    try {
        $file = Get-Item -LiteralPath $Path -ErrorAction SilentlyContinue
        if ($null -eq $file) {
            return ""
        }

        if (($file.Length / 1MB) -gt $MaxMB) {
            return "SKIPPED_OVER_LIMIT"
        }

        return (Get-FileHash -LiteralPath $Path -Algorithm SHA256 -ErrorAction SilentlyContinue).Hash
    }
    catch {
        return ""
    }
}

function Write-CsvSafe {
    param(
        [object[]]$Rows,
        [string]$Path
    )

    if ($null -eq $Rows) {
        $Rows = @()
    }

    $Rows | Export-Csv -Path $Path -NoTypeInformation -Encoding UTF8
}

if (-not (Safe-TestPath $Root)) {
    Write-Host "Root path does not exist: $Root"
    exit 1
}

Ensure-Directory $OutputDir

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"

$folderInventoryCsv = Join-Path $OutputDir "folder_inventory_$timestamp.csv"
$fileInventoryCsv = Join-Path $OutputDir "file_inventory_$timestamp.csv"
$projectInventoryCsv = Join-Path $OutputDir "project_inventory_$timestamp.csv"
$duplicateProjectsCsv = Join-Path $OutputDir "duplicate_project_candidates_$timestamp.csv"
$duplicateFilesCsv = Join-Path $OutputDir "duplicate_file_candidates_$timestamp.csv"
$dataAssetsCsv = Join-Path $OutputDir "data_assets_$timestamp.csv"
$archiveRecommendationsCsv = Join-Path $OutputDir "archive_recommendations_$timestamp.csv"
$dryRunPlanPs1 = Join-Path $OutputDir "DRY_RUN_archive_plan_$timestamp.ps1"
$summaryMd = Join-Path $OutputDir "repository_consolidation_summary_$timestamp.md"

Write-Status "Starting repository inventory."
Write-Status "Root: $Root"
Write-Status "Output: $OutputDir"

$topFolders = Get-SafeChildItems -Path $Root -DirectoriesOnly

$folderRows = @()
$projectRows = @()

foreach ($folder in $topFolders) {
    Write-Status "Scanning folder: $($folder.Name)"

    $flags = Get-ProjectFlags -Path $folder.FullName
    $classification = Classify-Folder -Name $folder.Name -FullPath $folder.FullName
    $sizeMB = Get-FolderSizeMB -Path $folder.FullName
    $fileCount = Get-FolderFileCount -Path $folder.FullName

    $folderRow = [PSCustomObject]@{
        Name = $folder.Name
        FullPath = $folder.FullName
        Parent = $folder.Parent.FullName
        LastWriteTime = $folder.LastWriteTime
        SizeMB = $sizeMB
        FileCount = $fileCount
        HasPackageJson = $flags.HasPackageJson
        HasNodeModules = $flags.HasNodeModules
        HasPythonProject = $flags.HasPythonProject
        HasPythonVenv = $flags.HasPythonVenv
        HasGit = $flags.HasGit
        PowerShellScriptCount = $flags.PowerShellScriptCount
        Recommendation = $classification[0]
        Reason = $classification[1]
        DuplicateKey = Normalize-DuplicateKey -Name $folder.Name
    }

    $folderRows += $folderRow

    if ($flags.HasPackageJson -or $flags.HasPythonProject -or $flags.HasGit -or $flags.PowerShellScriptCount -gt 0) {
        $projectRows += [PSCustomObject]@{
            Name = $folder.Name
            FullPath = $folder.FullName
            LastWriteTime = $folder.LastWriteTime
            SizeMB = $sizeMB
            ProjectType = @(
                if ($flags.HasPackageJson) { "Node" }
                if ($flags.HasPythonProject) { "Python" }
                if ($flags.HasGit) { "Git" }
                if ($flags.PowerShellScriptCount -gt 0) { "PowerShell" }
            ) -join "|"
            HasPackageJson = $flags.HasPackageJson
            HasPythonProject = $flags.HasPythonProject
            HasGit = $flags.HasGit
            Recommendation = $classification[0]
            Reason = $classification[1]
        }
    }
}

Write-Status "Scanning files. This may take a while."

$allFiles = Get-SafeChildItems -Path $Root -FilesOnly -Recurse
$fileRows = @()
$dataAssetRows = @()

foreach ($file in $allFiles) {
    $classification = Classify-File -File $file

    $hash = ""
    if ($HashFiles) {
        $hash = Get-FileHashSafe -Path $file.FullName -MaxMB $MaxHashFileMB
    }

    $row = [PSCustomObject]@{
        Name = $file.Name
        FullPath = $file.FullName
        Directory = $file.DirectoryName
        Extension = $file.Extension
        SizeMB = [math]::Round($file.Length / 1MB, 4)
        LastWriteTime = $file.LastWriteTime
        FileClass = $classification[0]
        Reason = $classification[1]
        SHA256 = $hash
    }

    $fileRows += $row

    if ($classification[0] -in @("PROTECT", "DATA_ASSET", "ARCHIVE_ARTIFACT")) {
        $dataAssetRows += $row
    }
}

Write-Status "Detecting duplicate project candidates."

$duplicateProjectRows = $folderRows |
    Group-Object DuplicateKey |
    Where-Object { $_.Count -gt 1 } |
    ForEach-Object {
        foreach ($item in $_.Group) {
            [PSCustomObject]@{
                DuplicateKey = $_.Name
                Name = $item.Name
                FullPath = $item.FullPath
                LastWriteTime = $item.LastWriteTime
                SizeMB = $item.SizeMB
                FileCount = $item.FileCount
                Recommendation = $item.Recommendation
                Reason = $item.Reason
            }
        }
    }

$duplicateFileRows = @()

if ($HashFiles) {
    Write-Status "Detecting duplicate files by SHA-256."

    $duplicateFileRows = $fileRows |
        Where-Object { $_.SHA256 -and $_.SHA256 -ne "SKIPPED_OVER_LIMIT" } |
        Group-Object SHA256 |
        Where-Object { $_.Count -gt 1 } |
        ForEach-Object {
            foreach ($item in $_.Group) {
                [PSCustomObject]@{
                    SHA256 = $_.Name
                    Name = $item.Name
                    FullPath = $item.FullPath
                    SizeMB = $item.SizeMB
                    LastWriteTime = $item.LastWriteTime
                    FileClass = $item.FileClass
                }
            }
        }
}
else {
    $duplicateFileRows = @(
        [PSCustomObject]@{
            SHA256 = "NOT_RUN"
            Name = "Duplicate file hashing not enabled"
            FullPath = "Run with -HashFiles to enable SHA-256 duplicate file detection"
            SizeMB = 0
            LastWriteTime = ""
            FileClass = "INFO"
        }
    )
}

$archiveRows = $folderRows |
    Where-Object {
        $_.Recommendation -in @(
            "ARCHIVE_CANDIDATE",
            "MERGE_OR_ARCHIVE",
            "DELETE_CANDIDATE_REVIEW_ONLY"
        )
    } |
    Sort-Object Recommendation, Name

Write-Status "Writing reports."

Write-CsvSafe -Rows $folderRows -Path $folderInventoryCsv
Write-CsvSafe -Rows $fileRows -Path $fileInventoryCsv
Write-CsvSafe -Rows $projectRows -Path $projectInventoryCsv
Write-CsvSafe -Rows $duplicateProjectRows -Path $duplicateProjectsCsv
Write-CsvSafe -Rows $duplicateFileRows -Path $duplicateFilesCsv
Write-CsvSafe -Rows $dataAssetRows -Path $dataAssetsCsv
Write-CsvSafe -Rows $archiveRows -Path $archiveRecommendationsCsv

$archiveRoot = "D:\P2GC_Archive\Repository_Consolidation_$timestamp"

$planLines = @()
$planLines += "# MILES OS Repository Consolidation Dry Run"
$planLines += "# Generated: $(Get-Date)"
$planLines += "# Root scanned: $Root"
$planLines += "# Archive root would be: $archiveRoot"
$planLines += "# SAFETY: This file is generated as dry-run guidance."
$planLines += "# SAFETY: Move-Item lines are commented out."
$planLines += ""
$planLines += "Write-Host 'DRY RUN ONLY - no files will be moved.'"
$planLines += ""

foreach ($row in ($archiveRows | Where-Object { $_.Recommendation -in @("ARCHIVE_CANDIDATE", "MERGE_OR_ARCHIVE") })) {
    $destination = Join-Path $archiveRoot $row.Name
    $planLines += ('Write-Host "Would move: {0} -> {1}"' -f $row.FullPath, $destination)
    $planLines += ('# Move-Item -LiteralPath "{0}" -Destination "{1}"' -f $row.FullPath, $destination)
    $planLines += ""
}

$planLines | Set-Content -Path $dryRunPlanPs1 -Encoding UTF8

$totalSize = ($folderRows | Measure-Object -Property SizeMB -Sum).Sum
$archiveSize = ($archiveRows | Measure-Object -Property SizeMB -Sum).Sum

if ($null -eq $totalSize) { $totalSize = 0 }
if ($null -eq $archiveSize) { $archiveSize = 0 }

$summary = @()
$summary += "# MILES Repository Consolidation Summary"
$summary += ""
$summary += "Generated: $(Get-Date)"
$summary += ""
$summary += "Root scanned: $Root"
$summary += ""
$summary += "## Safety"
$summary += ""
$summary += "- No files were moved."
$summary += "- No files were deleted."
$summary += "- No files were renamed."
$summary += "- This was a read-only scan."
$summary += ""
$summary += "## Folder Counts"
$summary += ""
$summary += "- Total top-level folders: $($folderRows.Count)"
$summary += "- KEEP: $(($folderRows | Where-Object { $_.Recommendation -eq 'KEEP' }).Count)"
$summary += "- REVIEW: $(($folderRows | Where-Object { $_.Recommendation -eq 'REVIEW' }).Count)"
$summary += "- ARCHIVE_CANDIDATE: $(($folderRows | Where-Object { $_.Recommendation -eq 'ARCHIVE_CANDIDATE' }).Count)"
$summary += "- MERGE_OR_ARCHIVE: $(($folderRows | Where-Object { $_.Recommendation -eq 'MERGE_OR_ARCHIVE' }).Count)"
$summary += "- DELETE_CANDIDATE_REVIEW_ONLY: $(($folderRows | Where-Object { $_.Recommendation -eq 'DELETE_CANDIDATE_REVIEW_ONLY' }).Count)"
$summary += ""
$summary += "## Disk Estimate"
$summary += ""
$summary += "- Total scanned top-level folder size MB: $([math]::Round($totalSize, 2))"
$summary += "- Candidate archive/delete review size MB: $([math]::Round($archiveSize, 2))"
$summary += ""
$summary += "## Projects"
$summary += ""
$summary += "- Project-like folders found: $($projectRows.Count)"
$summary += "- Duplicate project candidates: $($duplicateProjectRows.Count)"
$summary += ""
$summary += "## Files"
$summary += ""
$summary += "- Total files inventoried: $($fileRows.Count)"
$summary += "- Data/protected/archive assets inventoried: $($dataAssetRows.Count)"
if ($HashFiles) {
    $summary += "- Duplicate file candidates by hash: $($duplicateFileRows.Count)"
}
else {
    $summary += "- Duplicate file hashing: not enabled. Run with -HashFiles if needed."
}
$summary += ""
$summary += "## Output Files"
$summary += ""
$summary += "- Folder inventory: $folderInventoryCsv"
$summary += "- File inventory: $fileInventoryCsv"
$summary += "- Project inventory: $projectInventoryCsv"
$summary += "- Duplicate project candidates: $duplicateProjectsCsv"
$summary += "- Duplicate file candidates: $duplicateFilesCsv"
$summary += "- Data assets: $dataAssetsCsv"
$summary += "- Archive recommendations: $archiveRecommendationsCsv"
$summary += "- Dry-run archive plan: $dryRunPlanPs1"
$summary += ""
$summary += "## Recommended Next Step"
$summary += ""
$summary += "Review archive_recommendations and duplicate_project_candidates before moving anything."
$summary += "Do not delete ORION databases, client deliverables, credential files, proposal files, or production MILES folders."
$summary += ""

$summary | Set-Content -Path $summaryMd -Encoding UTF8

Write-Host ""
Write-Host "Repository inventory complete."
Write-Host "Summary: $summaryMd"
Write-Host "Folder inventory: $folderInventoryCsv"
Write-Host "File inventory: $fileInventoryCsv"
Write-Host "Project inventory: $projectInventoryCsv"
Write-Host "Duplicate projects: $duplicateProjectsCsv"
Write-Host "Archive recommendations: $archiveRecommendationsCsv"
Write-Host "Dry-run plan: $dryRunPlanPs1"
Write-Host ""
Write-Host "No files were moved or deleted."