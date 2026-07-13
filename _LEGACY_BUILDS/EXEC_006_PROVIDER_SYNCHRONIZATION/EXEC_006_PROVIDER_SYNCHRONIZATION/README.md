# EXEC_006 Provider Synchronization

Purpose: make every MILES subsystem agree on one provider model.

## Install

```powershell
cd "D:\P2GC_Intelligence\MILES_OS\EXEC_006_PROVIDER_SYNCHRONIZATION\EXEC_006_PROVIDER_SYNCHRONIZATION"
powershell -ExecutionPolicy Bypass -File .\INSTALL_PROVIDER_SYNC.ps1
```

## Verify

```powershell
powershell -ExecutionPolicy Bypass -File .\VERIFY_PROVIDER_SYNC.ps1
```

## Run

```powershell
powershell -ExecutionPolicy Bypass -File .\RUN_PROVIDER_SYNC.ps1
```

## Instantly read binding test

Requires `INSTANTLY_API_KEY` to be set in the current PowerShell session.

```powershell
powershell -ExecutionPolicy Bypass -File .\RUN_INSTANTLY_READ_BINDING_TEST.ps1
```

No live writes are performed by this package.
