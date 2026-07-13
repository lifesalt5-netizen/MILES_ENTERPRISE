# BUILD 015 Validation

Run:

```powershell
node test_coo_orchestrator.js
```

Expected:
- If the orchestrator succeeds, workflowResults will show queued work.
- If it fails, workflowResults will include a diagnostic object with the real underlying error.
