from __future__ import annotations

from collections import Counter
from typing import Any

from CORE.local_operator_queue import list_tasks
from CORE.platform_paths import status_dir
from CORE.json_store import read_json, utc_now, write_json


def build_report() -> dict[str, Any]:
    tasks = list_tasks()
    counts = Counter(task["queue_state"] for task in tasks)
    approval_needed = [t for t in tasks if t.get("approval_status") == "requires_ceo"]
    completed = [t for t in tasks if t.get("queue_state") == "completed"][-10:]
    failed = [t for t in tasks if t.get("queue_state") == "failed"][-10:]
    report = {
        "report_name": "MILES Local Operator Executive Report",
        "updated_at": utc_now(),
        "queue_counts": dict(counts),
        "ceo_approval_required": approval_needed,
        "recent_completed": completed,
        "recent_failed": failed,
        "operating_model": {
            "CEO": "Kevin approves business-risk, credential, publishing, sending, pricing, hiring, agreement, and destructive actions.",
            "Digital_COO": "Miles plans work, creates controlled tasks, monitors results, and reports status.",
            "Local_Operator": "Runs approved local tasks inside the repo and writes auditable runtime logs."
        },
    }
    write_json(status_dir() / "local_operator_executive_report.json", report)
    return report
