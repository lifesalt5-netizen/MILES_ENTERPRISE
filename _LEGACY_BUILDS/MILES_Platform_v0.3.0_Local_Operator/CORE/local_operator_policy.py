from __future__ import annotations

from dataclasses import dataclass
from typing import Any

AUTO_APPROVED_ACTIONS = {
    "health_check",
    "git_status",
    "dashboard_refresh",
    "connector_sync",
}

CEO_REQUIRED_ACTIONS = {
    "git_commit",
    "file_write",
    "python_module",
    "powershell_script",
}

BLOCKED_KEYWORDS = {
    "delete database",
    "drop table",
    "remove all",
    "send proposal",
    "change pricing",
    "hire contractor",
    "sign agreement",
    "send email campaign",
    "publish website",
}

@dataclass(frozen=True)
class PolicyDecision:
    risk_level: str
    approval_status: str
    reason: str


def evaluate_task(action: str, objective: str, params: dict[str, Any] | None = None) -> PolicyDecision:
    params = params or {}
    text = f"{action} {objective} {params}".lower()

    if any(keyword in text for keyword in BLOCKED_KEYWORDS):
        return PolicyDecision("blocked", "requires_ceo", "CEO approval required by governance policy.")

    if action in AUTO_APPROVED_ACTIONS:
        return PolicyDecision("low", "auto_approved", "Safe operational read/sync task.")

    if action in CEO_REQUIRED_ACTIONS:
        dry_run = bool(params.get("dry_run", True))
        if dry_run:
            return PolicyDecision("medium", "auto_approved", "Dry-run development operation is allowed.")
        return PolicyDecision("high", "requires_ceo", "Write or execution operation requires approval unless dry_run=true.")

    return PolicyDecision("medium", "requires_ceo", "Unknown action type requires CEO review.")
