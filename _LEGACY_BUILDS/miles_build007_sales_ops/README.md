# MILES Build 007 — Sales Operations Department

Adds Sales Operations service, pipeline/task registries, sales healthcheck, and a Sales Operations dashboard page.

Install from the extracted patch folder:
```powershell
powershell -ExecutionPolicy Bypass -File .\APPLY_BUILD_007.ps1
```

Then run:
```powershell
cd D:\P2GC_Intelligence\MILES_OS
npm start
```

Test:
```powershell
npm run sales:audit
```
