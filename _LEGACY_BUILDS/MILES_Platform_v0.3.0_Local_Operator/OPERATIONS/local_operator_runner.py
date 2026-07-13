from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Any

from CORE.json_store import read_json, utc_now, write_json
from CORE.local_operator_queue import init_operator_dirs, move_task, task_path
from CORE.platform_paths import log_dir, repo_root, status_dir

SAFE_TIMEOUT_SECONDS = 120


def _run_command(command: list[str], cwd: Path | None = None, timeout: int = SAFE_TIMEOUT_SECONDS) -> dict[str, Any]:
    started = utc_now()
    result = subprocess.run(
        command,
        cwd=str(cwd or repo_root()),
        text=True,
        capture_output=True,
        timeout=timeout,
        shell=False,
    )
    return {
        "started_at": started,
        "finished_at": utc_now(),
        "command": command,
        "returncode": result.returncode,
        "stdout": result.stdout[-12000:],
        "stderr": result.stderr[-12000:],
    }


def execute_task(task: dict[str, Any]) -> dict[str, Any]:
    action = task.get("action")
    params = task.get("params") or {}

    if action == "health_check":
        return {"ok": True, "checked_at": utc_now(), "repo_root": str(repo_root())}

    if action == "git_status":
        return _run_command(["git", "status", "--short"])

    if action == "dashboard_refresh":
        return {"ok": True, "message": "Dashboard refresh hook ready. Existing dashboard module can be called here."}

    if action == "connector_sync":
        connector = params.get("connector", "all")
        return {"ok": True, "connector": connector, "message": "Connector sync request recorded for platform connector layer."}

    if action == "python_module":
        if not params.get("dry_run", True):
            module = params.get("module")
            if not module:
                raise ValueError("python_module requires params.module")
            return _run_command(["python", "-m", module], timeout=int(params.get("timeout", SAFE_TIMEOUT_SECONDS)))
        return {"ok": True, "dry_run": True, "message": "Python module execution validated but not run."}

    if action == "powershell_script":
        if not params.get("dry_run", True):
            script = params.get("script")
            if not script:
                raise ValueError("powershell_script requires params.script")
            return _run_command(["powershell", "-ExecutionPolicy", "Bypass", "-File", script], timeout=int(params.get("timeout", SAFE_TIMEOUT_SECONDS)))
        return {"ok": True, "dry_run": True, "message": "PowerShell execution validated but not run."}

    if action == "file_write":
        if params.get("dry_run", True):
            return {"ok": True, "dry_run": True, "message": "File write validated but not written."}
        relative_path = params.get("path")
        content = params.get("content")
        if not relative_path or content is None:
            raise ValueError("file_write requires params.path and params.content")
        target = (repo_root() / relative_path).resolve()
        if repo_root() not in target.parents and target != repo_root():
            raise ValueError("file_write target must stay inside repo root")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(str(content), encoding="utf-8")
        return {"ok": True, "written": str(target)}

    raise ValueError(f"Unsupported operator action: {action}")


def run_once() -> list[dict[str, Any]]:
    init_operator_dirs()
    results: list[dict[str, Any]] = []
    for path in sorted((task_path("approved", "dummy").parent).glob("*.json")):
        task = read_json(path, {})
        task_id = task["task_id"]
        move_task(task_id, "approved", "running", {"status": "running", "started_at": utc_now()})
        try:
            output = execute_task(task)
            record = {**task, "status": "completed", "completed_at": utc_now(), "result": output}
            write_json(log_dir() / f"operator_{task_id}.json", record)
            move_task(task_id, "running", "completed", record)
            results.append(record)
        except Exception as exc:
            record = {**task, "status": "failed", "failed_at": utc_now(), "error": str(exc)}
            write_json(log_dir() / f"operator_{task_id}.json", record)
            move_task(task_id, "running", "failed", record)
            results.append(record)
    write_json(status_dir() / "local_operator_status.json", {"updated_at": utc_now(), "last_run_count": len(results), "results": results})
    return results
