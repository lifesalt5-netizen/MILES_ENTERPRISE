$OutputDir = "D:\P2GC_Intelligence\MILES_OS\reports\repository_consolidation"
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"

Get-Process |
    Sort-Object WorkingSet64 -Descending |
    Select-Object -First 40 `
        ProcessName,
        Id,
        @{Name="MemoryMB";Expression={[math]::Round($_.WorkingSet64 / 1MB, 2)}},
        CPU,
        Path |
    Export-Csv -NoTypeInformation -Path (Join-Path $OutputDir "ram_process_audit_$timestamp.csv")

Write-Host "RAM/process audit complete. No processes were stopped."
