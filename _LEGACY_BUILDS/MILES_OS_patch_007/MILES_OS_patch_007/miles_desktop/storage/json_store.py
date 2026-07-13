from __future__ import annotations

import json
from pathlib import Path
from threading import RLock
from typing import Any, Dict, Iterable, List, Optional


class JsonStore:
    """Small durable JSON store for local-first MILES Desktop state.

    This intentionally avoids a server dependency for the Desktop app. It can be
    replaced by SQLite later without changing higher-level services.
    """

    def __init__(self, root: str | Path):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self._lock = RLock()

    def _path(self, collection: str) -> Path:
        safe = collection.replace("/", "_").replace("\\", "_")
        return self.root / f"{safe}.json"

    def list(self, collection: str) -> List[Dict[str, Any]]:
        path = self._path(collection)
        if not path.exists():
            return []
        with self._lock:
            return json.loads(path.read_text(encoding="utf-8"))

    def save_all(self, collection: str, rows: Iterable[Dict[str, Any]]) -> None:
        path = self._path(collection)
        tmp = path.with_suffix(".tmp")
        with self._lock:
            tmp.write_text(json.dumps(list(rows), indent=2, ensure_ascii=False), encoding="utf-8")
            tmp.replace(path)

    def upsert(self, collection: str, row: Dict[str, Any], key: str = "id") -> Dict[str, Any]:
        rows = self.list(collection)
        found = False
        for idx, existing in enumerate(rows):
            if existing.get(key) == row.get(key):
                rows[idx] = row
                found = True
                break
        if not found:
            rows.append(row)
        self.save_all(collection, rows)
        return row

    def get(self, collection: str, value: str, key: str = "id") -> Optional[Dict[str, Any]]:
        for row in self.list(collection):
            if row.get(key) == value:
                return row
        return None
