BUILD 132 — INSTANTLY ENTERPRISE PROVIDER ADAPTER

Run from MILES_ENTERPRISE root:
powershell -ExecutionPolicy Bypass -File .\BUILD132\BUILD132.ps1

This build preserves the working live implementation at:
PROVIDERS\providers\InstantlyProvider.js

It adds a stable enterprise adapter and registers supported read operations.
No live write operation is introduced.
