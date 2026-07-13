param(
  [string]$Folder = "D:\P2GC_Intelligence\Good Files to use\Good To Use and segmented",
  [string]$BaseUrl = "http://127.0.0.1:8765"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$body = @{ folder = $Folder } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "$BaseUrl/segments/scan" -Body $body -ContentType "application/json" | ConvertTo-Json -Depth 10
