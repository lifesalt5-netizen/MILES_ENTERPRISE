# BUILD_036 Continuous COO Loop

## Purpose

BUILD_036 adds the Continuous COO Loop to MILES OS without redesigning or replacing the existing architecture.

Kevin remains CEO. Miles operates the autonomous COO runtime layer.

## Installs

```powershell
powershell -ExecutionPolicy Bypass -File .\INSTALL_COO_LOOP.ps1
```

## Run Once

```powershell
powershell -ExecutionPolicy Bypass -File .\RUN_COO_LOOP_ONCE.ps1
```

## Run Continuous

```powershell
powershell -ExecutionPolicy Bypass -File .\RUN_COO_LOOP.ps1
```

## Run With Auto-Restart Guardian

```powershell
powershell -ExecutionPolicy Bypass -File .\RUN_COO_LOOP_FOREVER.ps1
```

## Direct Node Command

```powershell
cd D:\P2GC_Intelligence\MILES_OS
node .\BUILDER\index.js COO_LOOP
```

## Verify

```powershell
powershell -ExecutionPolicy Bypass -File .\VERIFY_COO_LOOP.ps1
```

or

```powershell
cd D:\P2GC_Intelligence\MILES_OS
node .\VERIFY\VERIFY_COO_LOOP.js
```

## New Builder Actions

- `COO_LOOP`
- `CONTINUOUS_COO_LOOP`
- `VERIFY_COO_LOOP`

## Services Added

- `SERVICES\ContinuousCOOLoopService.js`
- `SERVICES\QueueRecoveryService.js`
- `SERVICES\HeartbeatService.js`
- `SERVICES\RuntimeHealthService.js`
- `SERVICES\RestartGuardianService.js`
- `SERVICES\LoopSchedulerService.js`
- `SERVICES\JsonFileService.js`
- `SERVICES\TimeUtil.js`

## Existing Services Orchestrated

- `ExecutiveBrainService`
- `CompanyStateService`
- `TaskRouterService`
- `WorkQueueService`

## Runtime Outputs

- `DATA\runtime\latest_coo_cycle.json`
- `DATA\runtime\coo_cycle_history.json`
- `DATA\runtime\coo_loop_heartbeat.json`
- `DATA\runtime\coo_loop_heartbeat_history.json`
- `DATA\runtime\coo_runtime_health.json`
- `DATA\runtime\coo_runtime_health_history.json`
- `DATA\runtime\restart_guardian.json`
- `DATA\runtime\restart_guardian_history.json`
- `DATA\runtime\queue_recovery_log.json`
- `DATA\runtime\coo_loop_report.md`

## Queue Recovery

BUILD_036 includes automatic queue recovery for malformed JSON in:

```text
DATA\runtime\work_queue.json
```

If the queue is corrupt, MILES will:

1. Copy the corrupt queue to a timestamped backup.
2. Create a clean v3 queue file.
3. Log the recovery event.
4. Continue the COO cycle.

## Loop Order

1. Heartbeat
2. Queue Recovery
3. Executive Brain
4. Company State
5. Task Router
6. Archive Closed Work
7. Runtime Health
8. Restart Guardian
9. Write COO cycle files
10. Sleep and repeat

## Environment Variables

```powershell
$env:MILES_ROOT = "D:\P2GC_Intelligence\MILES_OS"
$env:MILES_COO_LOOP_INTERVAL_MS = "60000"
$env:MILES_COO_LOOP_MAX_CYCLES = "1"
```

If `MILES_COO_LOOP_MAX_CYCLES` is omitted, the loop runs continuously.
