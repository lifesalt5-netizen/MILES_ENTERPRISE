# MILES Automation FastTrack v0.4.0

Purpose: move MILES from platform inventory into safe autonomous execution immediately.

This release does not rebuild existing MILES infrastructure. It plugs into the current repository root and uses existing files such as masters, outbound inventory, website queues, status, logs, reports, and task queues.

## What it installs

- CORE/csv_utils.js
- CORE/authority_gate.js
- CORE/autonomous_work_engine.js
- CONFIG/MILES_CAPABILITY_REGISTRY.csv
- EXECUTIVE/status_report.js
- scripts/RUN_MILES_AUTOMATION_FASTTRACK.ps1

## What it does now

Safe auto-executed actions:

- Campaign inventory status report
- Domain capacity report
- Segment status report
- Website queue review
- Instantly health snapshot from local inventory
- Executive dashboard refresh
- Daily executive brief generation
- Repository duplicate audit

Protected actions are routed to tasks/approval_queue.csv.

## Install

From the extracted package folder:

```powershell
.\scripts\INSTALL_MILES_AUTOMATION_FASTTRACK.ps1 -RepoRoot "D:\P2GC_Intelligence\MILES_OS"
```

## Run

```powershell
cd D:\P2GC_Intelligence\MILES_OS
.\scripts\RUN_MILES_AUTOMATION_FASTTRACK.ps1 -RepoRoot "D:\P2GC_Intelligence\MILES_OS"
```

## Output files

- logs/miles_automation_execution_log.csv
- tasks/approval_queue.csv
- reports/miles_automation_run_summary.csv
- reports/campaign_inventory_status.csv
- reports/domain_capacity_report.csv
- reports/segment_status_report.csv
- reports/website_ops_status.csv
- reports/instantly_health_snapshot.csv
- reports/repository_consolidation_report.csv
- status/daily_status.md
- MILES_DASHBOARD.csv

## Governance

The engine auto-executes low-risk operational tasks only. High-risk actions remain blocked and queued for CEO approval.

High-risk examples:

- Send campaign
- Start campaign
- Publish website change
- Delete data
- Change pricing
- Spend money
- Grant access
- Change DNS record

## Fastest next automation target

After this runs cleanly, bind CAP-008 to the live Instantly connector read methods, then add a protected write method for pause/resume campaign that routes through the authority gate.
