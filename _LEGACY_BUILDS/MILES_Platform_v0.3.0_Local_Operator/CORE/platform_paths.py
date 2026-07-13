from __future__ import annotations

import os
from pathlib import Path


def repo_root() -> Path:
    """Return the MILES Platform repository root.

    Priority:
    1. MILES_REPO_ROOT environment variable
    2. Current working directory
    """
    configured = os.environ.get("MILES_REPO_ROOT")
    if configured:
        return Path(configured).expanduser().resolve()
    return Path.cwd().resolve()


def ensure_dir(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path


def runtime_dir() -> Path:
    return ensure_dir(repo_root() / "runtime")


def operator_dir() -> Path:
    return ensure_dir(runtime_dir() / "operator")


def log_dir() -> Path:
    return ensure_dir(runtime_dir() / "logs")


def status_dir() -> Path:
    return ensure_dir(runtime_dir() / "status")
