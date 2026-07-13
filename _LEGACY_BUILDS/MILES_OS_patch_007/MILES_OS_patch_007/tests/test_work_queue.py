from miles_desktop.core.work_queue import WorkQueue
from miles_desktop.models.entities import Department, WorkItem, WorkStatus, ApprovalLevel
from miles_desktop.storage.json_store import JsonStore


def test_auto_work_becomes_ready(tmp_path):
    queue = WorkQueue(JsonStore(tmp_path))
    item = queue.add(WorkItem("Build parser", Department.ENGINEERING_OPS, "Create CSV parser"))
    assert item.status == WorkStatus.READY
    assert item.approval_level == ApprovalLevel.AUTO
    assert item.assigned_twin == "Miles Builder"


def test_pricing_requires_immediate_approval(tmp_path):
    queue = WorkQueue(JsonStore(tmp_path))
    item = queue.add(WorkItem("Change pricing", Department.SALES_OPS, "Change pricing for proposal"))
    assert item.status == WorkStatus.WAITING_APPROVAL
    assert item.approval_level == ApprovalLevel.IMMEDIATE
