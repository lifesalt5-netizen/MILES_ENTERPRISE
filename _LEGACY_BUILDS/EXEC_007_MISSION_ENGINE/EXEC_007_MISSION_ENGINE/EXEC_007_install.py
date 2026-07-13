from pathlib import Path
import shutil

def install(miles_root: str = r"D:\P2GC_Intelligence\Miles_OS") -> None:
    src = Path(__file__).resolve().parent
    dst = Path(miles_root) / "EXEC_007_MISSION_ENGINE"
    dst.mkdir(parents=True, exist_ok=True)
    for item in src.iterdir():
        target = dst / item.name
        if item.is_dir():
            shutil.copytree(item, target, dirs_exist_ok=True)
        else:
            shutil.copy2(item, target)
    print(f"EXEC_007 Mission Automation Engine installed to {dst}")
    print("Next: wire MISSION_ENGINE.ts to existing EXEC_005 Business Execution Engine adapter.")

if __name__ == "__main__":
    install()
