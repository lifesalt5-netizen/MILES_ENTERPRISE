BUILD 132 - INSTANTLY ENTERPRISE ADAPTER

Run from any extracted location:

powershell -ExecutionPolicy Bypass -File .\BUILD132.ps1

Optional explicit root:

powershell -ExecutionPolicy Bypass -File .\BUILD132.ps1 -MilesRoot "D:\P2GC_Intelligence\MILES_ENTERPRISE"

This build preserves the existing InstantlyProvider and Instantly connector.
It adds an enterprise adapter and registers its supported read capabilities.
No live mutation settings are changed.
