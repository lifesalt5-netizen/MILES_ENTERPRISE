import sqlite3
from pathlib import Path

def connect_orion(db_path, read_only=True):
    path = Path(db_path)
    if not path.exists():
        raise FileNotFoundError(f"ORION database not found: {db_path}")

    if read_only:
        uri = f"file:{path.as_posix()}?mode=ro"
        return sqlite3.connect(uri, uri=True)

    return sqlite3.connect(str(path))

def fetch_all(conn, sql, params=()):
    cur = conn.cursor()
    cur.execute(sql, params)
    cols = [d[0] for d in cur.description] if cur.description else []
    return [dict(zip(cols, row)) for row in cur.fetchall()]
