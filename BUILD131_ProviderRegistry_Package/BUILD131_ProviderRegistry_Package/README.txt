MILES ENTERPRISE — BUILD 131

PURPOSE
Integrates the existing SERVICES\ProviderRegistry.js into:
- SERVICES\BusinessOperationsBridgeService.js
- SERVICES\RevenueMissionSourceService.js

INSTALLATION
1. Extract this folder anywhere.
2. Open PowerShell in:
   D:\P2GC_Intelligence\MILES_ENTERPRISE
3. Run:

powershell -ExecutionPolicy Bypass -File "FULL_PATH_TO_EXTRACTED_FOLDER\BUILD131.ps1"

Example:
powershell -ExecutionPolicy Bypass -File "D:\Downloads\BUILD131_ProviderRegistry_Package\BUILD131.ps1"

The installer:
- backs up modified files
- patches both services
- runs syntax checks
- runs the Build 131 test
- runs Build 130 regression when found
- restores backups on failure
