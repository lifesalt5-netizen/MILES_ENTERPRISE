MILES RUNTIME REGISTRY SERVICE V2

PURPOSE

This is an independent runtime registry service. It does not patch or replace
StartMilesProduction.js.

It provides:

- Runtime self-registration API
- Heartbeats
- Deregistration
- Capability-provider lookup
- Active HTTP/TCP service probes
- Persistent service registry
- Persistent health summary
- JSONL lifecycle event log
- Independent port: 8791

DEFAULT DISCOVERY TARGETS

- Desktop UI: http://127.0.0.1:3737
- MILES API: http://127.0.0.1:3000
- Command Center: http://127.0.0.1:8787

INSTALL

1. Extract this ZIP.
2. Double-click INSTALL_RUNTIME_REGISTRY_SERVICE_V2.bat.
3. Open a separate PowerShell window.
4. Run:

   cd D:\P2GC_Intelligence\MILES_ENTERPRISE
   node StartRuntimeRegistryService.js

HEALTH

http://127.0.0.1:8791/health

SERVICES

http://127.0.0.1:8791/services

OUTPUT

D:\P2GC_Intelligence\MILES_ENTERPRISE\runtime\runtime_registry_v2\

- runtime_registry.json
- runtime_registry_summary.json
- runtime_registry_events.jsonl
- runtime_probes.json
- runtime_registry_service.pid

SELF-REGISTRATION

Existing workers and services can use:

SERVICES\runtime_registry\RuntimeRegistryClient.js

See EXAMPLE_SELF_REGISTRATION.js.

IMPORTANT

This service runs alongside MILES production. It does not modify the production
bootstrap. Once validated, it can be added to the supervisor as a normal fifth
runtime through the existing production process registry.
