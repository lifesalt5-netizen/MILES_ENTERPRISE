# EXEC_005 Business Execution Engine

Installs the MILES Business Execution Engine.

## Commands

```powershell
cd "D:\P2GC_Intelligence\MILES_OS\EXEC_005_BUSINESS_EXECUTION_ENGINE\EXEC_005_BUSINESS_EXECUTION_ENGINE"
powershell -ExecutionPolicy Bypass -File .\INSTALL_BUSINESS_EXECUTION_ENGINE.ps1
powershell -ExecutionPolicy Bypass -File .\VERIFY_BUSINESS_EXECUTION_ENGINE.ps1
powershell -ExecutionPolicy Bypass -File .\RUN_BUSINESS_EXECUTION_ENGINE.ps1
```

The default run is dry-run/safe dispatch. It plans work, evaluates provider readiness, escalates CEO-governed tasks, and dispatches only through verified provider execution services.
