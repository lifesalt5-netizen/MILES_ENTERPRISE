# BUILD 012 Validation

Run:

```powershell
node test_work_queue.js
node test_work_queue.js
node test_autonomous_coo_loop.js
```

Expected:
- Work queue migrates old items to schema v2.
- Repeated test runs do not create endless duplicates.
- Autonomous COO loop completes 1 cycle.
- DATA/executive/latest_coo_cycle.json is written.
- Authorized pending work becomes Queued / execution-ready.
