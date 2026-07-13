$Root = "D:\P2GC_Intelligence\MILES_OS"
$WorkFile = "$Root\MILES_WORK_REGISTRY.csv"
$AssetFile = "$Root\MILES_ASSET_REGISTRY.csv"
$AuthorityFile = "$Root\GOVERNANCE\MILES_AUTHORITY_MATRIX.csv"
$OutputDir = "$Root\OPERATOR\OUTPUTS"

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

$Timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

if (!(Test-Path $WorkFile)) {
    Write-Host "Missing MILES_WORK_REGISTRY.csv"
    exit
}

if (!(Test-Path $AuthorityFile)) {
    Write-Host "Missing MILES_AUTHORITY_MATRIX.csv"
    exit
}

$Work = Import-Csv $WorkFile
$Authority = Import-Csv $AuthorityFile

$NextActions = @()

foreach ($Item in $Work) {
    if ($Item.Status -in @("Queued","Active","Blocked")) {

        $Decision = "Review"
        $Approval = "Unknown"

        if ($Item.WorkItem -match "Website|Hero|Navigation|CTA|Landing") {
            $Decision = "Draft / Prepare"
            $Approval = "Kevin approval before publish"
        }
        elseif ($Item.System -match "Instantly|Segmentation|CRM") {
            $Decision = "Execute"
            $Approval = "No approval needed unless protected asset involved"
        }
        elseif ($Item.System -match "ORION") {
            $Decision = "Execute with backup"
            $Approval = "No approval unless deleting data"
        }
        elseif ($Item.System -match "Dreamers") {
            $Decision = "Prepare / Report"
            $Approval = "Kevin approval for client-facing final decisions"
        }

        if ($Item.WorkItem -match "pathways2gc.com.*outbound|outbound.*pathways2gc.com") {
            $Decision = "BLOCKED"
            $Approval = "Never allowed"
        }

        $NextActions += [PSCustomObject]@{
            Timestamp = $Timestamp
            WorkID = $Item.WorkID
            System = $Item.System
            WorkItem = $Item.WorkItem
            Priority = $Item.Priority
            Status = $Item.Status
            Owner = $Item.Owner
            MilesDecision = $Decision
            ApprovalRequirement = $Approval
            RecommendedNextStep = if ($Decision -eq "BLOCKED") { "Do not execute" } elseif ($Decision -like "Execute*") { "Move to execution queue" } else { "Prepare draft / briefing for Kevin" }
        }
    }
}

$NextActions | Export-Csv "$OutputDir\NEXT_ACTIONS.csv" -NoTypeInformation

$ExecSummary = [PSCustomObject]@{
    Timestamp = $Timestamp
    TotalWorkItems = $Work.Count
    OpenItems = ($Work | Where-Object {$_.Status -in @("Queued","Active","Blocked")}).Count
    P1Items = ($Work | Where-Object {$_.Priority -eq "P1"}).Count
    BlockedItems = ($Work | Where-Object {$_.Status -eq "Blocked"}).Count
    Output = "$OutputDir\NEXT_ACTIONS.csv"
}

$ExecSummary | Export-Csv "$OutputDir\MILES_OPERATOR_SUMMARY.csv" -NoTypeInformation

Add-Content "$Root\MILES_EXECUTION_LOG.csv" "$Timestamp,MILES_OPERATOR,Generated next actions,Success,Read work registry and produced NEXT_ACTIONS.csv"

Write-Host "MILES OPERATOR COMPLETE"
Write-Host "Output created: $OutputDir\NEXT_ACTIONS.csv"
