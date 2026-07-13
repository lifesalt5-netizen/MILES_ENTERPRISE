# BUILD 013 Validation

Run:

```powershell
node test_coo_orchestrator.js
node test_autonomous_coo_loop.js
```

Expected:
- COOOrchestratorService refreshes providers.
- Executive state is generated.
- Work queue is updated without duplicate explosion.
- Authorized pending work is handed to WorkflowService.
- Work item status moves to Queued.
- Runtime execution is not performed unless `executeRuntimeTasks: true`.
