from __future__ import annotations
from dataclasses import dataclass
import os


@dataclass(frozen=True)
class InstantlyConfig:
    api_key: str
    base_url: str = "https://api.instantly.ai/api/v2"
    timeout_seconds: int = 30
    dry_run: bool = True

    @classmethod
    def from_env(cls) -> "InstantlyConfig":
        key = os.getenv("INSTANTLY_API_KEY", "").strip()
        return cls(
            api_key=key,
            base_url=os.getenv("INSTANTLY_BASE_URL", cls.base_url).rstrip("/"),
            timeout_seconds=int(os.getenv("INSTANTLY_TIMEOUT_SECONDS", "30")),
            dry_run=os.getenv("MILES_DRY_RUN", "true").lower() != "false",
        )
