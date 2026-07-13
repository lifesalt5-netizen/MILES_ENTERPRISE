# MILES Repository Registry Full Scripts

Purpose:
Install Phase 1 of the Digital COO Core.

Phase:
1. Repository Registry

What it does:
- Scans MILES repository
- Classifies services, workers, providers, connectors, runtime, APIs, databases, events
- Detects duplicate risks
- Detects orphan risks
- Writes registry JSON files
- Writes executive inventory report

Install:
powershell -ExecutionPolicy Bypass -File .\INSTALL_REPOSITORY_REGISTRY.ps1

Run after install:
powershell -ExecutionPolicy Bypass -File .\RUN_REPOSITORY_REGISTRY.ps1

Direct command:
cd D:\P2GC_Intelligence\MILES_OS
node .\BUILDER\index.js REPOSITORY_REGISTRY

Outputs:
D:\P2GC_Intelligence\MILES_OS\DATA\repository
