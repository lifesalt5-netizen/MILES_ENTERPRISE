Write-Host "Installing INT_001 ORION Production Integration..."
if (!(Test-Path "config\orion_config.json")) {
  Copy-Item "config\orion_config.example.json" "config\orion_config.json"
  Write-Host "Created config\orion_config.json from example."
}
Write-Host "Run: python src\run_orion_health.py"
