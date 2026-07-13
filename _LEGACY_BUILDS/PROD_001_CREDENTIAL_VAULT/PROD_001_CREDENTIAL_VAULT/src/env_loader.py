from pathlib import Path
import os

def load_dotenv(path='.env'):
    env_path = Path(path)
    if not env_path.exists():
        return False
    for line in env_path.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))
    return True
