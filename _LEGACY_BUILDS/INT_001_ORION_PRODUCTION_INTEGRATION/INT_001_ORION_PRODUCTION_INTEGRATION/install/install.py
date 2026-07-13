from pathlib import Path
import shutil

print("Installing INT_001 ORION Production Integration...")
target = Path("config/orion_config.json")
if not target.exists():
    shutil.copy("config/orion_config.example.json", target)
    print("Created config/orion_config.json from example.")
print("Run: python src/run_orion_health.py")
