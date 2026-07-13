$ErrorActionPreference = "Stop"
Write-Host "Installing EXEC_009_NAMECHEAP..."
New-Item -ItemType Directory -Force -Path ./audit | Out-Null
New-Item -ItemType Directory -Force -Path ./state | Out-Null
if (!(Test-Path ./.env)) { Copy-Item ./.env.example ./.env }
Write-Host "EXEC_009 installed. Configure .env before live verification."
