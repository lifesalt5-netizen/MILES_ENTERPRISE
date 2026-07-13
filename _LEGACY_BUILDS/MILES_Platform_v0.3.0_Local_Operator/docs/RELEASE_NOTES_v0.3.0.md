# MILES Platform v0.3.0 — Controlled Local Operator Architecture

## Purpose
This release adds the local execution architecture required for MILES Platform to operate as a Digital COO through a controlled local operator.

Miles does not become an uncontrolled script runner. Miles creates governed work orders. The local operator executes only approved or auto-approved tasks inside the repository and writes audit logs/status files.

## Production Roles

### CEO — Kevin
Approves actions involving:
- credentials
- sending outbound campaigns
- publishing website changes
- pricing changes
- proposals/contracts
- hiring/contractors
- destructive data changes
- legal/business commitments

### Digital COO — Miles
Owns:
- planning
- task creation
- architecture
- integration coordination
- operational reporting
- priority recommendations
- controlled execution requests

### Local Operator
Runs on Kevin's local machine and performs approved repository operations:
- health checks
- git status
- connector sync hooks
- dashboard refresh hooks
- dry-run Python/PowerShell validations
- approved file writes/executions

## New Files

```text
CORE/platform_paths.py
CORE/json_store.py
CORE/local_operator_schema.py
CORE/local_operator_policy.py
CORE/local_operator_queue.py
OPERATIONS/local_operator_runner.py
EXECUTIVE/local_operator_report.py
miles_operator.py
scripts/install_miles_operator.ps1
scripts/miles_operator_run_once.ps1
docs/RELEASE_NOTES_v0.3.0.md
```

## Runtime Directories

```text
runtime/operator/inbox
runtime/operator/approved
runtime/operator/running
runtime/operator/completed
runtime/operator/failed
runtime/operator/rejected
runtime/logs
runtime/status
```

## Governance Model

Auto-approved:
- health_check
- git_status
- dashboard_refresh
- connector_sync

Dry-run approved:
- python_module with dry_run=true
- powershell_script with dry_run=true
- file_write with dry_run=true

CEO approval required:
- non-dry-run Python execution
- non-dry-run PowerShell execution
- non-dry-run file write
- git commit
- business-risk keywords such as send campaign, publish website, change pricing, hire contractor, sign agreement, delete database

## Install / Migration

From PowerShell:

```powershell
cd D:\P2GC_Intelligence\MILES_OS
# Copy the release files into this repo first, preserving folder structure.
.\scripts\install_miles_operator.ps1 -RepoRoot "D:\P2GC_Intelligence\MILES_OS"
```

## Smoke Test

```powershell
cd D:\P2GC_Intelligence\MILES_OS
python .\miles_operator.py submit --title "Git status check" --action git_status --module CORE --objective "Check repository status"
python .\miles_operator.py run-once
python .\miles_operator.py report
```

Expected outputs:
- completed task JSON in `runtime/operator/completed`
- operator log in `runtime/logs`
- executive report in `runtime/status/local_operator_executive_report.json`

## Next Release Recommendation
v0.4.0 should connect this operator to existing platform status files:
- Google connector health
- Instantly connector health
- campaign inventory
- executive dashboard refresh
- daily briefing generator
