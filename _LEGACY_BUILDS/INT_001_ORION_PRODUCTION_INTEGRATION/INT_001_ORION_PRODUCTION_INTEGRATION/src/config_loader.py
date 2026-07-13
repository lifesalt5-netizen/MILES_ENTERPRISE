from pathlib import Path
import json
import os

DEFAULT_DB_PATH = r"D:\P2GC_Intelligence\Orion Demo 6126\orion_live_demo_ready\ORION_DEMO_LIVE_READY.db"

def load_config(path="config/orion_config.json"):
    cfg_path = Path(path)
    if cfg_path.exists():
        return json.loads(cfg_path.read_text(encoding="utf-8"))

    example = Path("config/orion_config.example.json")
    if example.exists():
        cfg = json.loads(example.read_text(encoding="utf-8"))
    else:
        cfg = {"orion_db_path": DEFAULT_DB_PATH, "read_only": True, "report_output_dir": "reports"}

    env_db = os.environ.get("ORION_DB_PATH")
    if env_db:
        cfg["orion_db_path"] = env_db

    return cfg
