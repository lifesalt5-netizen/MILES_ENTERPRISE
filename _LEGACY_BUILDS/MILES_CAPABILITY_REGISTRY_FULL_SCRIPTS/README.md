# MILES Capability Registry Full Scripts

Phase:
2. Capability Registry

Requires:
Phase 1 Repository Registry already installed.

Install:
powershell -ExecutionPolicy Bypass -File .\INSTALL_CAPABILITY_REGISTRY.ps1

Run:
powershell -ExecutionPolicy Bypass -File .\RUN_CAPABILITY_REGISTRY.ps1

Direct command:
cd D:\P2GC_Intelligence\MILES_OS
node .\BUILDER\index.js CAPABILITY_REGISTRY

Outputs:
D:\P2GC_Intelligence\MILES_OS\DATA\capability

What this gives MILES:
- A map of what MILES can do
- Which components can execute each capability
- Which capabilities reduce Kevin's workload
- Which capabilities require governance approval
- Gaps before Executive Brain
