# EXEC_001 Unified Action Engine

This package continues the verified MILES OS build sequence after BUILD_038.

## Purpose

EXEC_001 moves Miles from orchestration into controlled execution.

It adds a unified action layer that:

- Reads queued work from `DATA/runtime/work_queue.json`
- Normalizes routed work into standard action records
- Resolves the correct provider
- Dispatches safe/internal actions
- Holds external-provider actions until provider controllers exist
- Verifies outcomes
- Records history and audit logs
- Updates the work queue lifecycle

## Important Governance Rule

EXEC_001 is safe by default.

External providers such as Instantly, Google Workspace, Namecheap, LinkedIn, CRM, and website publishing are registered but not live-executable until dedicated provider controllers and credentials are installed.

This prevents Miles from making unverified external changes before credential vault and connector runtime are ready.

## Install

```powershell
cd "D:\P2GC_Intelligence\MILES_OS\EXEC_001_UNIFIED_ACTION_ENGINE\EXEC_001_UNIFIED_ACTION_ENGINE"
powershell -ExecutionPolicy Bypass -File .\INSTALL_ACTION_ENGINE.ps1
```

## Verify

```powershell
cd "D:\P2GC_Intelligence\MILES_OS\EXEC_001_UNIFIED_ACTION_ENGINE\EXEC_001_UNIFIED_ACTION_ENGINE"
powershell -ExecutionPolicy Bypass -File .\VERIFY_ACTION_ENGINE.ps1
```

## Run

```powershell
cd "D:\P2GC_Intelligence\MILES_OS\EXEC_001_UNIFIED_ACTION_ENGINE\EXEC_001_UNIFIED_ACTION_ENGINE"
powershell -ExecutionPolicy Bypass -File .\RUN_ACTION_ENGINE.ps1
```

## Builder Commands

```powershell
cd "D:\P2GC_Intelligence\MILES_OS"
node .\BUILDER\index.js PROVIDER_REGISTRY
node .\BUILDER\index.js ACTION_ENGINE
node .\BUILDER\index.js ACTION_HISTORY
node .\BUILDER\index.js ACTION_AUDIT
```

## Installed Files

- `SERVICES/ProviderRegistryService.js`
- `SERVICES/ActionAuditService.js`
- `SERVICES/ActionHistoryService.js`
- `SERVICES/ActionVerificationService.js`
- `SERVICES/ActionRetryService.js`
- `SERVICES/ActionDispatcherService.js`
- `SERVICES/ActionEngineService.js`
- `BUILDER/BuilderService.js`

## Outputs

- `DATA/action_engine/provider_registry.json`
- `DATA/action_engine/provider_registry_report.md`
- `DATA/action_engine/latest_action_engine_run.json`
- `DATA/action_engine/action_history.json`
- `DATA/action_engine/action_audit_log.json`
- `DATA/action_engine/action_engine_report.md`
- `DATA/action_engine/action_queue.json`

## EXEC_001 Success Criteria

EXEC_001 is successful when:

1. Provider registry builds successfully.
2. Action engine runs successfully.
3. Queued work is normalized into actions.
4. Safe/internal actions are dispatched and verified.
5. External provider actions are held safely until connector controllers exist.
6. Audit and history files are written.
7. Work queue lifecycle is updated.
