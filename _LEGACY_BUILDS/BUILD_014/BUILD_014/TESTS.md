# BUILD 014 Validation

Run:

```powershell
node test_work_queue.js
node test_work_queue.js
node test_coo_orchestrator.js
```

Expected:
- Queue migrates to schema v3.
- Existing duplicate open items are archived.
- Repeated queue tests reuse the same open work item.
- COOOrchestrator no longer crashes on markFailed().
