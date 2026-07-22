MILES ENTERPRISE — BUILD 131 V2

This package is compatible with Windows PowerShell 5.1.

RUN FROM:
D:\P2GC_Intelligence\MILES_ENTERPRISE

COMMAND:
powershell -ExecutionPolicy Bypass -File ".\BUILD131_ProviderRegistry_Package_v2\BUILD131.ps1"

If the package folder is nested twice after extraction, use:
powershell -ExecutionPolicy Bypass -File ".\BUILD131_ProviderRegistry_Package_v2\BUILD131_ProviderRegistry_Package_v2\BUILD131.ps1"

The installer automatically:
- validates required files
- creates backups
- integrates ProviderRegistry
- runs Node syntax checks
- runs the Build 131 test
- runs Build 130 regression when found
- rolls back changed files on failure
