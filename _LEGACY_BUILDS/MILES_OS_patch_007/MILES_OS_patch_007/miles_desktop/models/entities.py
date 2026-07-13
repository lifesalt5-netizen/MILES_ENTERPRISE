from __future__ import annotations

from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional
from uuid import uuid4


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class ApprovalLevel(str, Enum):
    AUTO = "auto"
    DAILY = "daily_approval"
    IMMEDIATE = "immediate_approval"
    BLOCKED = "blocked"


class WorkStatus(str, Enum):
    NEW = "new"
    READY = "ready"
    RUNNING = "running"
    WAITING_APPROVAL = "waiting_approval"
    COMPLETED = "completed"
    FAILED = "failed"
    BLOCKED = "blocked"


class Department(str, Enum):
    EXECUTIVE_OPS = "Executive Operations"
    SALES_OPS = "Sales Operations"
    OUTBOUND_OPS = "Outbound Operations"
    WEBSITE_OPS = "Website Operations"
    ORION_OPS = "ORION Operations"
    ENGINEERING_OPS = "Engineering Operations"
    EXECUTIVE_DEMO_OPS = "Executive Demo Operations"
    GOV_INTEL_OPS = "Government Intelligence Operations"
    KNOWLEDGE = "Knowledge/Learning"


@dataclass(slots=True)
class WorkItem:
    title: str
    department: Department
    objective: str
    source: str = "manual"
    priority: int = 50
    approval_level: ApprovalLevel = ApprovalLevel.AUTO
    status: WorkStatus = WorkStatus.NEW
    id: str = field(default_factory=lambda: str(uuid4()))
    created_at: str = field(default_factory=utc_now)
    updated_at: str = field(default_factory=utc_now)
    due_at: Optional[str] = None
    assigned_twin: Optional[str] = None
    system: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)
    events: List[Dict[str, Any]] = field(default_factory=list)

    def touch(self) -> None:
        self.updated_at = utc_now()

    def add_event(self, event_type: str, message: str, **data: Any) -> None:
        self.events.append({"at": utc_now(), "type": event_type, "message": message, "data": data})
        self.touch()

    def to_dict(self) -> Dict[str, Any]:
        data = asdict(self)
        data["department"] = self.department.value
        data["approval_level"] = self.approval_level.value
        data["status"] = self.status.value
        return data

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "WorkItem":
        payload = dict(data)
        payload["department"] = Department(payload["department"])
        payload["approval_level"] = ApprovalLevel(payload["approval_level"])
        payload["status"] = WorkStatus(payload["status"])
        return cls(**payload)


@dataclass(slots=True)
class SystemRecord:
    name: str
    owner_department: Department
    purpose: str
    access_status: str = "unknown"
    authority_required: ApprovalLevel = ApprovalLevel.AUTO
    url: Optional[str] = None
    notes: str = ""
    id: str = field(default_factory=lambda: str(uuid4()))
    created_at: str = field(default_factory=utc_now)
    updated_at: str = field(default_factory=utc_now)

    def to_dict(self) -> Dict[str, Any]:
        data = asdict(self)
        data["owner_department"] = self.owner_department.value
        data["authority_required"] = self.authority_required.value
        return data

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "SystemRecord":
        payload = dict(data)
        payload["owner_department"] = Department(payload["owner_department"])
        payload["authority_required"] = ApprovalLevel(payload["authority_required"])
        return cls(**payload)


@dataclass(slots=True)
class SegmentRecord:
    segment_name: str
    source_file: str
    lead_count: int = 0
    verified_email_count: int = 0
    campaign_status: str = "not_loaded"
    needs_enrichment: bool = False
    needs_upload: bool = True
    assigned_domain_pool: Optional[str] = None
    assigned_campaign: Optional[str] = None
    priority: int = 50
    id: str = field(default_factory=lambda: str(uuid4()))
    last_refreshed: str = field(default_factory=utc_now)

    @property
    def email_ready_ratio(self) -> float:
        if self.lead_count <= 0:
            return 0.0
        return round(self.verified_email_count / self.lead_count, 4)

    def to_dict(self) -> Dict[str, Any]:
        data = asdict(self)
        data["email_ready_ratio"] = self.email_ready_ratio
        return data

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "SegmentRecord":
        payload = dict(data)
        payload.pop("email_ready_ratio", None)
        return cls(**payload)
