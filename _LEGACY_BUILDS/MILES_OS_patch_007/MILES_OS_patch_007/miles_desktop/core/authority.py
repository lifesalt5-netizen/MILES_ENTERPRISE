from __future__ import annotations

from miles_desktop.models.entities import ApprovalLevel, Department, WorkItem


class AuthorityMatrix:
    """Encodes Kevin approval boundaries for Never Wait execution."""

    IMMEDIATE_KEYWORDS = (
        "send proposal", "change pricing", "hire", "delete data", "sign agreement",
        "send client proposal", "contract", "legal", "payment", "invoice discount",
    )
    DAILY_KEYWORDS = (
        "website publish", "linkedin post", "new campaign", "domain change",
        "mailbox create", "email account", "dns", "instantly launch",
    )
    BLOCKED_KEYWORDS = ("password", "credential export", "bypass", "evade", "scrape restricted")

    def classify(self, item: WorkItem) -> ApprovalLevel:
        text = f"{item.title} {item.objective} {item.system or ''}".lower()
        if any(k in text for k in self.BLOCKED_KEYWORDS):
            return ApprovalLevel.BLOCKED
        if any(k in text for k in self.IMMEDIATE_KEYWORDS):
            return ApprovalLevel.IMMEDIATE
        if any(k in text for k in self.DAILY_KEYWORDS):
            return ApprovalLevel.DAILY
        if item.department in {Department.ENGINEERING_OPS, Department.KNOWLEDGE, Department.ORION_OPS}:
            return ApprovalLevel.AUTO
        return item.approval_level
