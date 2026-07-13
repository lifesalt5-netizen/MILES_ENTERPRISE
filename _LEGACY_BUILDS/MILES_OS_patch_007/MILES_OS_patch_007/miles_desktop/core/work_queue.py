from __future__ import annotations

from typing import List, Optional

from miles_desktop.core.authority import AuthorityMatrix
from miles_desktop.core.router import TwinRouter
from miles_desktop.models.entities import ApprovalLevel, WorkItem, WorkStatus
from miles_desktop.storage.json_store import JsonStore


class WorkQueue:
    COLLECTION = "work_items"

    def __init__(self, store: JsonStore, authority: AuthorityMatrix | None = None, router: TwinRouter | None = None):
        self.store = store
        self.authority = authority or AuthorityMatrix()
        self.router = router or TwinRouter()

    def add(self, item: WorkItem) -> WorkItem:
        item.approval_level = self.authority.classify(item)
        if item.approval_level == ApprovalLevel.BLOCKED:
            item.status = WorkStatus.BLOCKED
            item.add_event("blocked", "Blocked by authority matrix")
        elif item.approval_level in {ApprovalLevel.DAILY, ApprovalLevel.IMMEDIATE}:
            item.status = WorkStatus.WAITING_APPROVAL
            item.add_event("approval_required", f"Requires {item.approval_level.value}")
        else:
            item.status = WorkStatus.READY
            item.add_event("ready", "Ready for execution")
        self.router.assign(item)
        self.store.upsert(self.COLLECTION, item.to_dict())
        return item

    def list(self, status: Optional[WorkStatus] = None) -> List[WorkItem]:
        rows = [WorkItem.from_dict(row) for row in self.store.list(self.COLLECTION)]
        if status:
            rows = [row for row in rows if row.status == status]
        return sorted(rows, key=lambda x: (-x.priority, x.created_at))

    def approve(self, item_id: str, approver: str = "Kevin") -> WorkItem:
        row = self.store.get(self.COLLECTION, item_id)
        if not row:
            raise KeyError(f"Work item not found: {item_id}")
        item = WorkItem.from_dict(row)
        if item.status != WorkStatus.WAITING_APPROVAL:
            item.add_event("approval_noop", "Approval received but item was not waiting")
        else:
            item.status = WorkStatus.READY
            item.add_event("approved", f"Approved by {approver}")
        self.store.upsert(self.COLLECTION, item.to_dict())
        return item

    def complete(self, item_id: str, message: str = "Completed") -> WorkItem:
        row = self.store.get(self.COLLECTION, item_id)
        if not row:
            raise KeyError(f"Work item not found: {item_id}")
        item = WorkItem.from_dict(row)
        item.status = WorkStatus.COMPLETED
        item.add_event("completed", message)
        self.store.upsert(self.COLLECTION, item.to_dict())
        return item
