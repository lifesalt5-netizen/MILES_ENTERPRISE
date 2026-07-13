from __future__ import annotations

import shutil
import uuid
from pathlib import Path
from typing import Any

from CORE.json_store import read_json, utc_now, write_json
from CORE.local_operator_policy import evaluate_task
from CORE.local_operator_schema import OperatorTask
from CORE.platform_paths import ensure_dir, operator_dir

STATES = ["inbox", "approved", "running", "completed", "failed", "rejected"]


def init_operator_dirs() -> None:
    base = operator_dir()
    for state in STATES:
        ensure_dir(base / state)


def task_path(state: str, task_id: str) -> Path:
    return operator_dir() / state / f"{task_id}.json"


def submit_task(task: OperatorTask) -> dict[str, Any]:
    init_operator_dirs()
    task.task_id = task.task_id or f"op_{uuid.uuid4().hex[:12]}"
    task.created_at = task.created_at or utc_now()
    decision = evaluate_task(task.action, task.objective, task.params)
    task.risk_level = decision.risk_level  # type: ignore[assignment]
    task.approval_status = decision.approval_status  # type: ignore[assignment]
    task.status = "approved" if decision.approval_status == "auto_approved" else "queued"
    payload = task.to_dict()
    payload["policy_reason"] = decision.reason
    destination = "approved" if task.status == "approved" else "inbox"
    write_json(task_path(destination, task.task_id), payload)
    return payload


def list_tasks(state: str | None = None) -> list[dict[str, Any]]:
    init_operator_dirs()
    states = [state] if state else STATES
    records: list[dict[str, Any]] = []
    for s in states:
        for path in sorted((operator_dir() / s).glob("*.json")):
            item = read_json(path, {})
            item["queue_state"] = s
            records.append(item)
    return records


def approve_task(task_id: str) -> dict[str, Any]:
    init_operator_dirs()
    src = task_path("inbox", task_id)
    if not src.exists():
        raise FileNotFoundError(f"Task not found in inbox: {task_id}")
    data = read_json(src, {})
    data["approval_status"] = "approved"
    data["status"] = "approved"
    data["approved_at"] = utc_now()
    dst = task_path("approved", task_id)
    write_json(dst, data)
    src.unlink()
    return data


def reject_task(task_id: str, reason: str = "Rejected by CEO") -> dict[str, Any]:
    init_operator_dirs()
    src = task_path("inbox", task_id)
    if not src.exists():
        raise FileNotFoundError(f"Task not found in inbox: {task_id}")
    data = read_json(src, {})
    data["approval_status"] = "rejected"
    data["status"] = "rejected"
    data["rejected_at"] = utc_now()
    data["rejection_reason"] = reason
    dst = task_path("rejected", task_id)
    write_json(dst, data)
    src.unlink()
    return data


def move_task(task_id: str, src_state: str, dst_state: str, patch: dict[str, Any] | None = None) -> dict[str, Any]:
    src = task_path(src_state, task_id)
    if not src.exists():
        raise FileNotFoundError(f"Task not found: {src}")
    data = read_json(src, {})
    if patch:
        data.update(patch)
    dst = task_path(dst_state, task_id)
    write_json(dst, data)
    src.unlink()
    return data
