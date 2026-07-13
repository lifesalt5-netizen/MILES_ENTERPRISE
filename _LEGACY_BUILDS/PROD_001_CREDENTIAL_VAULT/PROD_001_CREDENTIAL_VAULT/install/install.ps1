Write-Host "Installing PROD_001 Credential Vault + Provider Validation Harness..."
if (!(Test-Path ".env")) {
  Copy-Item "examples\.env.example" ".env"
  Write-Host "Created .env from example. Edit .env locally with real values."
}
Write-Host "Run: python src\run_validation.py"
