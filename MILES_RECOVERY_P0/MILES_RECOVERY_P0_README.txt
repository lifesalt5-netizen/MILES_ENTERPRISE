MILES RECOVERY P0

Installs:
1. Executive conversation routing before queue creation.
2. Natural executive responses instead of default JSON dumps.
3. Approval Center with Approve, Deny, and Modify.
4. Protected campaign launches and proposal submissions.
5. Removal of the BUILD124 debug stop if present.

Run from PowerShell:
Set-ExecutionPolicy -Scope Process Bypass
cd <folder containing these files>
.\INSTALL_MILES_RECOVERY_P0.ps1

Then restart MILES:
cd D:\P2GC_Intelligence\MILES_ENTERPRISE
taskkill /F /IM node.exe
node .\StartMilesProduction.js

Acceptance tests:
- What can you do?
- Review my campaigns.
- Launch the SBS campaign.
