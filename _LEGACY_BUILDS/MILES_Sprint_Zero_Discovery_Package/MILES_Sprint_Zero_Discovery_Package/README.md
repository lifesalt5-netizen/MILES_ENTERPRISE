# MILES Sprint Zero Discovery Package

Purpose: inventory existing MILES architecture before building new functionality.

## Install

Copy:

- `sprint-zero-discovery.js` into your repo at `tools/sprint-zero-discovery.js`
- `run-sprint-zero.ps1` into your repo root

## Run

```powershell
cd D:\P2GC_Intelligence\MILES_OS
.\run-sprint-zero.ps1
```

Or:

```powershell
node tools\sprint-zero-discovery.js
```

## Outputs

Created in:

```text
sprint_zero_output/
```

Files generated:

- SYSTEM_REGISTRY.json
- SERVICE_REGISTRY.json
- WORKER_REGISTRY.json
- PROVIDER_REGISTRY.json
- CONNECTOR_REGISTRY.json
- API_REGISTRY.json
- DATABASE_REGISTRY.json
- RUNTIME_REGISTRY.json
- ENGINEERING_REGISTRY.json
- AUTOMATION_REGISTRY.json
- MISSION_SYSTEM_REGISTRY.json
- EVENT_GRAPH.json
- DEPENDENCY_GRAPH.json
- DUPLICATE_REPORT.json
- ORPHAN_REPORT.json
- BUILD_RECOMMENDATIONS.json

## Locked engineering rule

No new business functionality until discovery, duplicate review, orphan review, dependency mapping, and event mapping are complete.

Active COO runtime remains:

```text
AutonomousCOOLoopService
```

Legacy runtime:

```text
ProductionCOOEngine
```
