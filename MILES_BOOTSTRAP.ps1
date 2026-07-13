# MILES BOOTSTRAP CORE

function Write-Log {
    param(
        [string]$msg,
        [string]$type = "INFO"
    )

    Write-Host "[] $msg"
}

# LOAD CORE FILES
$Global:exec = Import-Csv "D:\P2GC_Intelligence\MILES_OS\masters\EXECUTION_ENGINE_MASTER.csv"
$Global:segments = Import-Csv "D:\P2GC_Intelligence\MILES_OS\masters\SEGMENT_INVENTORY.csv"
$Global:campaigns = Import-Csv "D:\P2GC_Intelligence\MILES_OS\masters\CAMPAIGN_MASTER.csv"
$Global:domains = Import-Csv "D:\P2GC_Intelligence\MILES_OS\masters\DOMAIN_MASTER.csv"
$Global:state = Import-Csv "D:\P2GC_Intelligence\MILES_OS\masters\STATE_ENGINE_MASTER.csv"

# SYSTEM STATUS
Write-Host "MILES BOOTSTRAP LOADED" -ForegroundColor Green
Write-Host ("Exec Rows: " + $Global:exec.Count)
Write-Host ("Segments: " + $Global:segments.Count)
Write-Host ("Campaigns: " + $Global:campaigns.Count)
Write-Host ("Domains: " + $Global:domains.Count)
