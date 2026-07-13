D:\P2GC_Intelligence = "D:\P2GC_Intelligence\MILES_OS\masters"
D:\P2GC_Intelligence\MILES_OS\output = "D:\P2GC_Intelligence\MILES_OS\output"

   = Import-Csv "D:\P2GC_Intelligence\EXECUTION_ENGINE_MASTER.csv"
                                                                                                                                                                                                                                                                            = Import-Csv "D:\P2GC_Intelligence\SEGMENT_INVENTORY.csv"
 = "D:\P2GC_Intelligence\STATE_ENGINE_MASTER.csv"

function Update-State {
    param(
        [string]$campaignId,
        [string]$newState
    )

    $state = Import-Csv 

    foreach ($row in $state) {
        if ($row.campaign_id -eq $campaignId) {
            $row.state = $newState
            $row.last_state_change = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
        }
    }

    $state | Export-Csv  -NoTypeInformation -Force
}

while ($true) {

    Write-Host "
--- LOOP TICK ---"

    foreach ($job in $exec) {

        $seg = $segments | Where-Object { $_.segment_name -eq $job.segment_name } | Select-Object -First 1

        if (-not $seg) { continue }

        if (-not (Test-Path $seg.file_location)) { continue }

        $limit = [int]$job.leads_to_send

        $data = Import-Csv $seg.file_location | Select-Object -First $limit

        $outFile = "D:\P2GC_Intelligence\MILES_OS\output\RUN_.csv"

        $data | Export-Csv $outFile -NoTypeInformation -Force

        Write-Host "EXECUTED:  -> 20"

    }

    Start-Sleep -Seconds 10
}
