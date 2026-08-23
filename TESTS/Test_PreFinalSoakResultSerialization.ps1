$ErrorActionPreference = 'Stop'

$results = New-Object System.Collections.Generic.List[object]
$results.Add([pscustomobject]@{name='a';status='GREEN';externalMutation=$false}) | Out-Null
$results.Add([pscustomobject]@{name='b';status='YELLOW';externalMutation=$true}) | Out-Null

$resultItems = $results.ToArray()
$red = @($resultItems | Where-Object { $_.status -eq 'RED' }).Count
$yellow = @($resultItems | Where-Object { $_.status -eq 'YELLOW' }).Count
$green = @($resultItems | Where-Object { $_.status -eq 'GREEN' }).Count
$mutations = @($resultItems | Where-Object { $_.externalMutation -eq $true }).Count
$statusText = if($red -eq 0){'PRE_FINAL_SOAK_READINESS_GREEN'}else{'PRE_FINAL_SOAK_READINESS_BLOCKED'}

$result = [ordered]@{
    ok = ($red -eq 0)
    status = $statusText
    counts = [ordered]@{
        green = $green
        yellow = $yellow
        red = $red
        controlledMutations = $mutations
        total = $resultItems.Count
    }
    results = $resultItems
}

$json = $result | ConvertTo-Json -Depth 10
if($result.status -ne 'PRE_FINAL_SOAK_READINESS_GREEN'){ throw 'Unexpected readiness status.' }
if($result.counts.green -ne 1 -or $result.counts.yellow -ne 1 -or $result.counts.red -ne 0){ throw 'Unexpected counts.' }
if($result.counts.total -ne 2){ throw 'Generic-list snapshot did not preserve result count.' }
if($json -notmatch 'PRE_FINAL_SOAK_READINESS_GREEN'){ throw 'Serialization did not preserve status.' }

Write-Host 'PRE_FINAL_SOAK_POWERSHELL51_SERIALIZATION=PASS'
