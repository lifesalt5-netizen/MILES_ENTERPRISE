# MILES Builder Autonomy Patch v1

Purpose:
Extend the existing BUILDER subsystem instead of creating a duplicate engineering service.

Adds:
- ArchitectureDiscovery.js
- System registry
- Component registry
- Capability registry
- Dependency graph
- Event graph
- Executive architecture report

Run after patching BuilderService:

node .\BUILDER\index.js DISCOVER_ARCHITECTURE

or:

node .\BUILDER\index.js ENGINEERING_HEALTH

Outputs:
DATA\builder\system_registry.json
DATA\builder\component_registry.json
DATA\builder\capability_registry.json
DATA\builder\dependency_graph.json
DATA\builder\event_graph.json
DATA\builder\architecture_discovery.json
DATA\builder\architecture_executive_report.md

Strategic reason:
MILES cannot become the Digital COO until it knows what it can already operate.
