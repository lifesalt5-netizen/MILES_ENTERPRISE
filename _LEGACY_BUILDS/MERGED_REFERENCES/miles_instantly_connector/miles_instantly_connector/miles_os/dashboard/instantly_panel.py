from __future__ import annotations
from typing import Any, Dict


def build_instantly_panel(snapshot: Dict[str, Any]) -> Dict[str, Any]:
    health = snapshot.get("health", {})
    return {
        "panel_id": "instantly_operations",
        "title": "Instantly Operations",
        "status": "ONLINE" if health.get("ok") else "OFFLINE",
        "metrics": {
            "api_version": health.get("details", {}).get("api_version", "v2"),
            "campaigns_reachable": health.get("details", {}).get("campaigns_reachable", False),
            "accounts_reachable": health.get("details", {}).get("accounts_reachable", False),
        },
        "alerts": [] if health.get("ok") else [health.get("details", {}).get("error", "Unknown Instantly error")],
    }
