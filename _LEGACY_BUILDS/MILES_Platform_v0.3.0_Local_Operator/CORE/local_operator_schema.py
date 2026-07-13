from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

OperatorAction = Literal[
    "health_check",
    "git_status",
    "git_commit",
    "python_module",
    "powershell_script",
    "file_write",
    "connector_sync",
    "dashboard_refresh",
]

RiskLevel = Literal["low", "medium", "high", "blocked"]
ApprovalStatus = Literal["auto_approved", "requires_ceo", "approved", "rejected"]
TaskStatus = Literal["queued", "approved", "running", "completed", "failed", "rejected"]


@dataclass
class OperatorTask:
    title: str
    action: OperatorAction
    module: str
    requested_by: str = "Miles"
    objective: str = ""
    params: dict[str, Any] = field(default_factory=dict)
    risk_level: RiskLevel = "low"
    approval_status: ApprovalStatus = "auto_approved"
    task_id: str | None = None
    created_at: str | None = None
    status: TaskStatus = "queued"

    def to_dict(self) -> dict[str, Any]:
        return {
            "task_id": self.task_id,
            "created_at": self.created_at,
            "title": self.title,
            "objective": self.objective,
            "requested_by": self.requested_by,
            "module": self.module,
            "action": self.action,
            "params": self.params,
            "risk_level": self.risk_level,
            "approval_status": self.approval_status,
            "status": self.status,
        }
