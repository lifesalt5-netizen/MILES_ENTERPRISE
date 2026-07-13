# EXEC_002 Provider Controllers

Installs the first provider controller layer for MILES OS.

Run:

```powershell
cd "D:\P2GC_Intelligence\MILES_OS\EXEC_002_PROVIDER_CONTROLLERS\EXEC_002_PROVIDER_CONTROLLERS"
powershell -ExecutionPolicy Bypass -File .\INSTALL_PROVIDER_CONTROLLERS.ps1
powershell -ExecutionPolicy Bypass -File .\VERIFY_PROVIDER_CONTROLLERS.ps1
powershell -ExecutionPolicy Bypass -File .\RUN_PROVIDER_CONTROLLERS.ps1
```

This build installs safe-mode controllers for Instantly, Google Workspace, Namecheap, Website, ORION, and File System.

External providers remain non-destructive until credentials and real API execution are configured.
