from pathlib import Path
import shutil

print("Installing PROD_001 Credential Vault + Provider Validation Harness...")
if not Path(".env").exists():
    shutil.copy("examples/.env.example", ".env")
    print("Created .env from example. Edit .env locally with real values.")
print("Run: python src/run_validation.py")
