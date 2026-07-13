# EXEC_002 — Provider Controllers

Purpose: give the verified Action Engine provider-specific execution targets.

Installed services:
- BaseProviderController.js
- ProviderControllerRegistryService.js
- ProviderControllerExecutionService.js
- ProviderControllerHealthService.js
- InstantlyProviderController.js
- GoogleWorkspaceProviderController.js
- NamecheapProviderController.js
- WebsiteProviderController.js
- OrionProviderController.js
- FileSystemProviderController.js

Supported builder actions:
- PROVIDER_CONTROLLERS
- PROVIDER_CONTROLLER_HEALTH
- PROVIDER_CONTROLLER_EXECUTE
- EXEC_002_VERIFY

Safety:
- External providers install in safe mode.
- They normalize, validate, report, and return WAITING/SAFE status until credentials and real API methods are configured.
- FileSystem is executable but is constrained to MILES_ROOT.
