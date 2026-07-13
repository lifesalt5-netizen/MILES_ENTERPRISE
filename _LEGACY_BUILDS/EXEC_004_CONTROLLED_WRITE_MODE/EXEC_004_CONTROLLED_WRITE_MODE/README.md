# EXEC_004 Controlled Write Mode

Adds a guarded live-write layer for MILES OS.

## Install

```powershell
cd "D:\P2GC_Intelligence\MILES_OS\EXEC_004_CONTROLLED_WRITE_MODE\EXEC_004_CONTROLLED_WRITE_MODE"
powershell -ExecutionPolicy Bypass -File .\INSTALL_CONTROLLED_WRITE.ps1
```

## Verify / Dry Run

```powershell
powershell -ExecutionPolicy Bypass -File .\VERIFY_CONTROLLED_WRITE.ps1
powershell -ExecutionPolicy Bypass -File .\RUN_CONTROLLED_WRITE_DRY_RUN.ps1
```

## Live Write Test

Only for a controlled test campaign. Requires all of:

```powershell
$env:INSTANTLY_API_KEY="YOUR_KEY"
$env:MILES_CONTROLLED_WRITE_ENABLED="true"
$env:INSTANTLY_WRITE_ENABLED="true"
powershell -ExecutionPolicy Bypass -File .\RUN_CONTROLLED_WRITE_LIVE_TEST.ps1
```

All live campaign names are required to begin with `MILES_TEST_`.
