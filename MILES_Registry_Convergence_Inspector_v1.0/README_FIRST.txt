MILES REGISTRY CONVERGENCE INSPECTOR

Why this is required:
The current MILES audit shows that the production root already contains several
registry systems, including ServiceRegistry, WorkerRegistry, CapabilityRegistry,
ProviderRegistry, PlannerRegistry, RepositoryRegistry, and runtime managers.

We should not add another runtime registry blindly. This inspector collects only
the relevant architecture files so they can be reconciled into one source of truth.

Use:
1. Extract this ZIP.
2. Double-click RUN_REGISTRY_CONVERGENCE_INSPECTOR.bat.
3. Upload the generated _REGISTRY_CONVERGENCE_*.zip.

No credentials, .env files, databases, or client data are collected.
