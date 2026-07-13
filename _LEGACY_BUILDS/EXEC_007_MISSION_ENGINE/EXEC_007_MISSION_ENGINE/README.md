# EXEC_007 Mission Automation Engine

Miles OS execution-phase module. This package adds autonomous mission planning, scheduling, verification, retry, escalation, KPI logging, and learning hooks while preserving compatibility with BUILD_031 through EXEC_006.

## Rule
EXEC_007 does not call live providers directly. It creates verified executable tasks and submits them through the existing Business Execution Engine / Unified Action Engine.

## Entry Point
- `MISSION_ENGINE.ts`

## Compatibility
- BUILD_031 Repository Registry: read only
- BUILD_032 Capability Registry: read only
- BUILD_033 Executive Brain: receives goals / priorities
- BUILD_034 Company State: reads and updates mission state only
- BUILD_035 Task Router: compatible task output
- BUILD_036 Continuous COO Loop: scheduler target
- BUILD_037 Executive Dashboard: KPI output
- BUILD_038 Self Learning Layer: learning events
- EXEC_001 Unified Action Engine: downstream executor
- EXEC_005 Business Execution Engine: operational executor
- EXEC_006 Provider Synchronization: provider readiness state
