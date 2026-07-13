from pathlib import Path
print("Installing EXEC_009_NAMECHEAP...")
Path("audit").mkdir(exist_ok=True)
Path("state").mkdir(exist_ok=True)
if not Path(".env").exists():
    Path(".env").write_text(Path(".env.example").read_text())
print("EXEC_009 installed. Configure .env before live verification.")
