from __future__ import annotations

import argparse
import json
from CORE.local_operator_queue import approve_task, list_tasks, reject_task, submit_task
from CORE.local_operator_schema import OperatorTask
from OPERATIONS.local_operator_runner import run_once
from EXECUTIVE.local_operator_report import build_report


def main() -> None:
    parser = argparse.ArgumentParser(prog="miles_operator", description="MILES Platform controlled local operator CLI")
    sub = parser.add_subparsers(dest="cmd", required=True)

    create = sub.add_parser("submit")
    create.add_argument("--title", required=True)
    create.add_argument("--action", required=True)
    create.add_argument("--module", default="CORE")
    create.add_argument("--objective", default="")
    create.add_argument("--params-json", default="{}")

    list_cmd = sub.add_parser("list")
    list_cmd.add_argument("--state", default=None)

    approve = sub.add_parser("approve")
    approve.add_argument("task_id")

    reject = sub.add_parser("reject")
    reject.add_argument("task_id")
    reject.add_argument("--reason", default="Rejected by CEO")

    sub.add_parser("run-once")
    sub.add_parser("report")

    args = parser.parse_args()

    if args.cmd == "submit":
        task = OperatorTask(
            title=args.title,
            action=args.action,
            module=args.module,
            objective=args.objective,
            params=json.loads(args.params_json),
        )
        print(json.dumps(submit_task(task), indent=2))
    elif args.cmd == "list":
        print(json.dumps(list_tasks(args.state), indent=2))
    elif args.cmd == "approve":
        print(json.dumps(approve_task(args.task_id), indent=2))
    elif args.cmd == "reject":
        print(json.dumps(reject_task(args.task_id, args.reason), indent=2))
    elif args.cmd == "run-once":
        print(json.dumps(run_once(), indent=2))
    elif args.cmd == "report":
        print(json.dumps(build_report(), indent=2))


if __name__ == "__main__":
    main()
