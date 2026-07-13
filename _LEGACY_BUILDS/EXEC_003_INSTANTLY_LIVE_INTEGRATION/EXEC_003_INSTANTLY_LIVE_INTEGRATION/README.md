# EXEC_003 Instantly Live Integration

Purpose: connect the verified Action Engine and Provider Controller framework to a live Instantly execution surface.

## Install

```powershell
cd "D:\P2GC_Intelligence\MILES_OS\EXEC_003_INSTANTLY_LIVE_INTEGRATION\EXEC_003_INSTANTLY_LIVE_INTEGRATION"
powershell -ExecutionPolicy Bypass -File .\INSTALL_INSTANTLY_LIVE.ps1
```

## Verify

```powershell
powershell -ExecutionPolicy Bypass -File .\VERIFY_EXEC_003.ps1
```

## Run

```powershell
powershell -ExecutionPolicy Bypass -File .\RUN_INSTANTLY_HEALTH.ps1
powershell -ExecutionPolicy Bypass -File .\RUN_INSTANTLY_LIVE.ps1
powershell -ExecutionPolicy Bypass -File .\RUN_INSTANTLY_BRIDGE_ACTION.ps1
```

## Credentials

Read operations require:

```powershell
$env:INSTANTLY_API_KEY="your_api_key"
```

Write operations remain disabled until explicitly enabled:

```powershell
$env:INSTANTLY_WRITE_ENABLED="true"
```

Optional API base URL override:

```powershell
$env:INSTANTLY_BASE_URL="https://api.instantly.ai/api/v2"
```

## Output

Writes to:

`D:\P2GC_Intelligence\MILES_OS\DATA\instantly_live`
