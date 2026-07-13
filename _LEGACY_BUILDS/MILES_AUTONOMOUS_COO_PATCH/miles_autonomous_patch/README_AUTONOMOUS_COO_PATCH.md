# MILES Autonomous COO Patch

Install by copying these files into the root of the active MILES OS folder, preserving paths.

## Files included

- `StartAutonomousCOO.js`
- `CORE/Logger.js`
- `SERVICES/AutonomousCOOLoopService.js`
- `SERVICES/ExecutiveIntelligenceService.js`
- `SERVICES/ExecutionService.js`
- `SERVICES/WorkflowService.js`
- `SERVICES/WorkforceExecutionService.js`
- `SERVICES/Browser/Workers/InstantlyCampaignOperator.js`

## Run one autonomous COO cycle

```powershell
cd D:\P2GC_Intelligence\MILES_OS
$env:MILES_ROOT="D:\P2GC_Intelligence\MILES_OS"
node StartAutonomousCOO.js
```

## Run continuous autonomous COO loop

```powershell
cd D:\P2GC_Intelligence\MILES_OS
$env:MILES_ROOT="D:\P2GC_Intelligence\MILES_OS"
node StartAutonomousCOO.js --loop
```

## Optional controls

```powershell
$env:MILES_AUTONOMOUS_EXECUTE="true"
$env:MILES_AUTONOMOUS_QUEUE_WORKFLOWS="true"
$env:MILES_AUTONOMOUS_EXECUTION_PASSES="5"
$env:MILES_AUTONOMOUS_INTERVAL_MS="300000"
```

## Outputs

- `DATA/executive/latest_coo_cycle.md`
- `DATA/executive/latest_mission_plan.json`
- `DATA/executive/latest_universal_health.json`
- `DATA/executive/latest_autonomy_scorecard.json`
- `DATA/autonomous_repair/latest_repair_plan.json`
- `DATA/capability_backlog/latest_capability_backlog.json`
- `DATA/runtime/latest_coo_cycle.json`

## What this patch does

- Adds the autonomous COO cycle entrypoint.
- Builds an executive mission plan every cycle.
- Scores universal system health.
- Creates autonomous repair work.
- Creates capability backlog items.
- Queues authorized workflows.
- Optionally executes queued runtime tasks.
- Writes executive outputs for review.
- Fixes workflow provider/action propagation.
- Fixes workforce execution await/verification handling.
- Keeps provider failures from crashing the COO loop.
