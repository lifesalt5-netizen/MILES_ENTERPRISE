MILES ENTERPRISE REGISTRY — PHASE 1

PURPOSE
Creates the source-of-truth Component Registry and Capability Registry.

INSTALL
1. Extract this ZIP.
2. Double-click INSTALL_MILES_ENTERPRISE_REGISTRY.bat.
3. The installer copies the files into:
   D:\P2GC_Intelligence\MILES_ENTERPRISE
4. It runs a validation test.
5. It builds the first live registry.

OUTPUT
D:\P2GC_Intelligence\MILES_ENTERPRISE\runtime\enterprise_registry\

FILES CREATED
- component_registry.json
- component_registry_summary.json
- component_registry_changes.json
- capability_registry.json
- capability_registry_summary.json
- capability_routing_table.json

RUN AGAIN
D:\P2GC_Intelligence\MILES_ENTERPRISE\RUN_ENTERPRISE_REGISTRY.ps1

WHAT THIS PHASE ACCOMPLISHES
- MILES discovers its active components.
- MILES classifies workers, planners, connectors, providers, runtimes, governance,
  dashboards, databases, tests, memory, and learning components.
- MILES records supported and approval-required actions when found.
- MILES detects added, removed, and changed components.
- MILES maps capabilities to preferred and fallback providers.
- Legacy and reference builds are excluded from production routing.
