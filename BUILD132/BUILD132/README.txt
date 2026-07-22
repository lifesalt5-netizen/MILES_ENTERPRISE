BUILD132 - Instantly Enterprise Provider Consolidation

Run from Windows PowerShell 5.1:

Set-ExecutionPolicy -Scope Process Bypass
.\BUILD132.ps1

Optional root override:
.\BUILD132.ps1 -MilesRoot "D:\P2GC_Intelligence\MILES_ENTERPRISE"

The installer runs package tests, creates an automatic backup, applies the patch,
performs Node syntax checks, validates the installed files, and automatically
rolls back if installation fails.
