# BUILD_037 Verification

The verification script checks:

1. Required service files exist.
2. JavaScript syntax passes `node --check`.
3. `node .\BUILDER\index.js EXECUTIVE_DASHBOARD` runs successfully.
4. Dashboard outputs are generated.

Run:

```powershell
cd "D:\P2GC_Intelligence\MILES_OS\BUILD_037_EXECUTIVE_DASHBOARD"
powershell -ExecutionPolicy Bypass -File .\VERIFY_EXECUTIVE_DASHBOARD.ps1
```
