param(
  [string]$BaseUrl = "http://127.0.0.1:8765"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Invoke-RestMethod -Method Post -Uri "$BaseUrl/bootstrap" | ConvertTo-Json -Depth 5
Invoke-RestMethod -Method Get -Uri "$BaseUrl/work" | ConvertTo-Json -Depth 10
