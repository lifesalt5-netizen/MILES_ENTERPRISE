# MILES Developer Intelligence Index

Generated: 2026-07-11T19:32:05.382Z

## Executive Summary

| Metric | Result |
|---|---:|
| Files Indexed | 10934 |
| JavaScript Files | 534 |
| Active Candidates | 319 |
| Tests | 73 |
| Classes Found | 335 |
| Functions Found | 1294 |
| Imports Found | 1263 |
| Local Dependency Edges | 581 |
| Capabilities Found | 636 |
| Duplicate Name Groups | 77 |
| Unreferenced Active Candidates | 86 |
| Files Skipped | 6 |

## Module Type Counts

| Type | Count |
|---|---:|
| RECOMMENDATION | 8459 |
| APPROVAL | 8388 |
| INSTANTLY | 7046 |
| TEST | 3020 |
| QUEUE | 2136 |
| WORKER | 2046 |
| SUPERVISOR | 1745 |
| SERVICE | 1528 |
| WEBSITE | 1119 |
| ORION | 1070 |
| CONNECTOR | 707 |
| ENGINE | 330 |
| REGISTRY | 213 |
| SELF_HEALING | 144 |
| DASHBOARD | 113 |
| MANAGER | 111 |
| PLANNER | 111 |
| MEMORY | 95 |
| ORCHESTRATOR | 66 |
| POLICY | 65 |
| GOOGLE | 60 |
| EVENT_BUS | 41 |

## Duplicate Candidates

| Base Name | Count | Files |
|---|---:|---|
| status | 8 | DEPARTMENTS\ENGINEERING\STATUS.json<br>DEPARTMENTS\EXECUTIVE\STATUS.json<br>DEPARTMENTS\INFRASTRUCTURE\STATUS.json<br>DEPARTMENTS\OPERATIONS\STATUS.json<br>DEPARTMENTS\ORION\STATUS.json<br>DEPARTMENTS\PROPOSALS\STATUS.json<br>DEPARTMENTS\REVENUE\STATUS.json<br>DEPARTMENTS\RUNTIME\STATUS.json |
| backlog | 8 | DEPARTMENTS\ENGINEERING\BACKLOG.json<br>DEPARTMENTS\EXECUTIVE\BACKLOG.json<br>DEPARTMENTS\INFRASTRUCTURE\BACKLOG.json<br>DEPARTMENTS\OPERATIONS\BACKLOG.json<br>DEPARTMENTS\ORION\BACKLOG.json<br>DEPARTMENTS\PROPOSALS\BACKLOG.json<br>DEPARTMENTS\REVENUE\BACKLOG.json<br>DEPARTMENTS\RUNTIME\BACKLOG.json |
| startproductionsystem | 7 | SERVICES\StartProductionSystem.js<br>PROVIDERS\StartProductionSystem.js<br>StartProductionSystem.js<br>_REGISTRY_CONVERGENCE_20260710_192356\StartProductionSystem.js<br>_REGISTRY_CONVERGENCE_20260710_192356\SERVICES\StartProductionSystem.js<br>_REGISTRY_CONVERGENCE_20260710_193412\StartProductionSystem.js<br>_REGISTRY_CONVERGENCE_20260710_193412\SERVICES\StartProductionSystem.js |
| workerregistry | 6 | SERVICES\worker_runtime\WorkerRegistry.js<br>SERVICES\WorkerRegistry.js<br>_REGISTRY_CONVERGENCE_20260710_192356\SERVICES\WorkerRegistry.js<br>_REGISTRY_CONVERGENCE_20260710_192356\SERVICES\worker_runtime\WorkerRegistry.js<br>_REGISTRY_CONVERGENCE_20260710_193412\SERVICES\WorkerRegistry.js<br>_REGISTRY_CONVERGENCE_20260710_193412\SERVICES\worker_runtime\WorkerRegistry.js |
| providerregistry | 6 | PROVIDERS\registry\ProviderRegistry.js<br>PROVIDERS\ProviderRegistry.js<br>_REGISTRY_CONVERGENCE_20260710_192356\PROVIDERS\ProviderRegistry.js<br>_REGISTRY_CONVERGENCE_20260710_192356\PROVIDERS\registry\ProviderRegistry.js<br>_REGISTRY_CONVERGENCE_20260710_193412\PROVIDERS\ProviderRegistry.js<br>_REGISTRY_CONVERGENCE_20260710_193412\PROVIDERS\registry\ProviderRegistry.js |
| eventbus | 4 | CORE\EventBus.js<br>CORE\Kernel\EventBus.js<br>CORE\CANONICAL\EventBus.js<br>SERVICES\Events\EventBus.js |
| registry | 4 | CORE\CANONICAL\Registry.js<br>CONNECTORS\INSTANTLY\miles_instantly_connector\miles_os\services\instantly\registry.py<br>_REGISTRY_CONVERGENCE_20260710_192356\CORE\CANONICAL\Registry.js<br>_REGISTRY_CONVERGENCE_20260710_193412\CORE\CANONICAL\Registry.js |
| buildenterpriseregistry | 4 | MILES_Enterprise_Registry_Phase1_v1.0\BuildEnterpriseRegistry.js<br>BuildEnterpriseRegistry.js<br>_REGISTRY_CONVERGENCE_20260710_192356\BuildEnterpriseRegistry.js<br>_REGISTRY_CONVERGENCE_20260710_193412\BuildEnterpriseRegistry.js |
| run_enterprise_registry | 4 | MILES_Enterprise_Registry_Phase1_v1.0\RUN_ENTERPRISE_REGISTRY.ps1<br>RUN_ENTERPRISE_REGISTRY.ps1<br>_REGISTRY_CONVERGENCE_20260710_192356\RUN_ENTERPRISE_REGISTRY.ps1<br>_REGISTRY_CONVERGENCE_20260710_193412\RUN_ENTERPRISE_REGISTRY.ps1 |
| logger | 3 | CORE\logger.js<br>CORE\CANONICAL\Logger.js<br>CONNECTORS\WEBSITE_B12\modules\logger.js |
| serviceregistry | 3 | CORE\Kernel\ServiceRegistry.js<br>_REGISTRY_CONVERGENCE_20260710_192356\CORE\Kernel\ServiceRegistry.js<br>_REGISTRY_CONVERGENCE_20260710_193412\CORE\Kernel\ServiceRegistry.js |
| departmentregistry | 3 | CORE\DepartmentRegistry.js<br>_REGISTRY_CONVERGENCE_20260710_192356\CORE\DepartmentRegistry.js<br>_REGISTRY_CONVERGENCE_20260710_193412\CORE\DepartmentRegistry.js |
| capabilityregistryservice | 3 | SERVICES\CapabilityRegistryService.js<br>_REGISTRY_CONVERGENCE_20260710_192356\SERVICES\CapabilityRegistryService.js<br>_REGISTRY_CONVERGENCE_20260710_193412\SERVICES\CapabilityRegistryService.js |
| providerauthorityregistryservice | 3 | SERVICES\ProviderAuthorityRegistryService.js<br>_REGISTRY_CONVERGENCE_20260710_192356\SERVICES\ProviderAuthorityRegistryService.js<br>_REGISTRY_CONVERGENCE_20260710_193412\SERVICES\ProviderAuthorityRegistryService.js |
| providercontrollerregistryservice | 3 | SERVICES\ProviderControllerRegistryService.js<br>_REGISTRY_CONVERGENCE_20260710_192356\SERVICES\ProviderControllerRegistryService.js<br>_REGISTRY_CONVERGENCE_20260710_193412\SERVICES\ProviderControllerRegistryService.js |
| providerregistryservice | 3 | SERVICES\ProviderRegistryService.js<br>_REGISTRY_CONVERGENCE_20260710_192356\SERVICES\ProviderRegistryService.js<br>_REGISTRY_CONVERGENCE_20260710_193412\SERVICES\ProviderRegistryService.js |
| repositoryregistryservice | 3 | SERVICES\RepositoryRegistryService.js<br>_REGISTRY_CONVERGENCE_20260710_192356\SERVICES\RepositoryRegistryService.js<br>_REGISTRY_CONVERGENCE_20260710_193412\SERVICES\RepositoryRegistryService.js |
| digitalcooruntimemanager | 3 | SERVICES\digital_coo\DigitalCOORuntimeManager.js<br>_REGISTRY_CONVERGENCE_20260710_192356\SERVICES\digital_coo\DigitalCOORuntimeManager.js<br>_REGISTRY_CONVERGENCE_20260710_193412\SERVICES\digital_coo\DigitalCOORuntimeManager.js |
| milescommandcenter | 3 | SERVICES\digital_coo\MilesCommandCenter.js<br>_REGISTRY_CONVERGENCE_20260710_192356\SERVICES\digital_coo\MilesCommandCenter.js<br>_REGISTRY_CONVERGENCE_20260710_193412\SERVICES\digital_coo\MilesCommandCenter.js |
| plannerregistry | 3 | SERVICES\Planning\PlannerRegistry.js<br>_REGISTRY_CONVERGENCE_20260710_192356\SERVICES\Planning\PlannerRegistry.js<br>_REGISTRY_CONVERGENCE_20260710_193412\SERVICES\Planning\PlannerRegistry.js |
| workerruntime | 3 | SERVICES\worker_runtime\WorkerRuntime.js<br>_REGISTRY_CONVERGENCE_20260710_192356\SERVICES\worker_runtime\WorkerRuntime.js<br>_REGISTRY_CONVERGENCE_20260710_193412\SERVICES\worker_runtime\WorkerRuntime.js |
| workerruntimemanager | 3 | SERVICES\worker_runtime\WorkerRuntimeManager.js<br>_REGISTRY_CONVERGENCE_20260710_192356\SERVICES\worker_runtime\WorkerRuntimeManager.js<br>_REGISTRY_CONVERGENCE_20260710_193412\SERVICES\worker_runtime\WorkerRuntimeManager.js |
| capabilityregistry | 3 | SERVICES\CapabilityRegistry.js<br>_REGISTRY_CONVERGENCE_20260710_192356\SERVICES\CapabilityRegistry.js<br>_REGISTRY_CONVERGENCE_20260710_193412\SERVICES\CapabilityRegistry.js |
| enterpriseruntimemanager | 3 | SERVICES\EnterpriseRuntimeManager.js<br>_REGISTRY_CONVERGENCE_20260710_192356\SERVICES\EnterpriseRuntimeManager.js<br>_REGISTRY_CONVERGENCE_20260710_193412\SERVICES\EnterpriseRuntimeManager.js |
| config | 3 | CONNECTORS\GOOGLE\config.js<br>CONNECTORS\GOOGLE\miles_google_connector_pack\miles_google_connector_pack\CONNECTORS\GOOGLE\config.js<br>CONNECTORS\INSTANTLY\miles_instantly_connector\miles_os\services\instantly\config.py |
| index | 3 | CONNECTORS\GOOGLE\index.js<br>CONNECTORS\GOOGLE\miles_google_account_manager_dropin\CONNECTORS\GOOGLE\index.js<br>CONNECTORS\GOOGLE\miles_google_connector_pack\miles_google_connector_pack\CONNECTORS\GOOGLE\index.js |
| connector | 3 | CONNECTORS\INSTANTLY\connector.js<br>CONNECTORS\MILES\connector.js<br>CONNECTORS\ORION\connector.js |
| __init__ | 3 | CONNECTORS\INSTANTLY\miles_instantly_connector\miles_os\__init__.py<br>CONNECTORS\INSTANTLY\miles_instantly_connector\miles_os\services\__init__.py<br>CONNECTORS\INSTANTLY\miles_instantly_connector\miles_os\services\instantly\__init__.py |
| startautonomouscoo | 3 | StartAutonomousCOO.js<br>_REGISTRY_CONVERGENCE_20260710_192356\StartAutonomousCOO.js<br>_REGISTRY_CONVERGENCE_20260710_193412\StartAutonomousCOO.js |
| startmilesproduction | 3 | StartMilesProduction.js<br>_REGISTRY_CONVERGENCE_20260710_192356\StartMilesProduction.js<br>_REGISTRY_CONVERGENCE_20260710_193412\StartMilesProduction.js |
| connectormanager | 2 | CORE\ConnectorManager.js<br>SERVICES\ConnectorManager.js |
| taskqueue | 2 | CORE\TaskQueue.js<br>CORE\CANONICAL\TaskQueue.js |
| startmiles | 2 | CORE\Kernel\StartMiles.js<br>StartMiles.js |
| autonomouscooloopservice | 2 | SERVICES\AutonomousCOOLoopService.js<br>AutonomousCOOLoopService.js |
| connectorruntimemanager | 2 | SERVICES\ConnectorRuntimeManager.js<br>SERVICES\connector_runtime\ConnectorRuntimeManager.js |
| decisionengine | 2 | SERVICES\DecisionEngine.js<br>SERVICES\Decision\DecisionEngine.js |
| marketingcooservice | 2 | SERVICES\digital_coo\MarketingCOOService.js<br>BACKUPS\CAMPAIGN_REGISTRY_CONSOLIDATION_20260710_150636\MarketingCOOService.js |
| learningengine | 2 | SERVICES\Learning\LearningEngine.js<br>SERVICES\learning_engine\LearningEngine.js |
| instantlycooworker | 2 | SERVICES\workers\InstantlyCOOWorker.js<br>BACKUPS\CAMPAIGN_REGISTRY_CONSOLIDATION_20260710_150636\InstantlyCOOWorker.js |
| enterprisecomponentregistryservice | 2 | SERVICES\registry\EnterpriseComponentRegistryService.js<br>MILES_Enterprise_Registry_Phase1_v1.0\SERVICES\registry\EnterpriseComponentRegistryService.js |
| enterprisecapabilityregistryservice | 2 | SERVICES\registry\EnterpriseCapabilityRegistryService.js<br>MILES_Enterprise_Registry_Phase1_v1.0\SERVICES\registry\EnterpriseCapabilityRegistryService.js |
| runtimeregistryservice | 2 | SERVICES\runtime_registry\RuntimeRegistryService.js<br>MILES_Runtime_Registry_Service_V2_v2.0\SERVICES\runtime_registry\RuntimeRegistryService.js |
| runtimeregistryclient | 2 | SERVICES\runtime_registry\RuntimeRegistryClient.js<br>MILES_Runtime_Registry_Service_V2_v2.0\SERVICES\runtime_registry\RuntimeRegistryClient.js |
| instantlyprovider | 2 | PROVIDERS\providers\InstantlyProvider.js<br>PROVIDERS\InstantlyProvider.js |
| account_manager | 2 | CONNECTORS\GOOGLE\account_manager.js<br>CONNECTORS\GOOGLE\miles_google_account_manager_dropin\CONNECTORS\GOOGLE\account_manager.js |
| auth | 2 | CONNECTORS\GOOGLE\auth.js<br>CONNECTORS\GOOGLE\miles_google_connector_pack\miles_google_connector_pack\CONNECTORS\GOOGLE\auth.js |
| calendar | 2 | CONNECTORS\GOOGLE\calendar.js<br>CONNECTORS\GOOGLE\miles_google_connector_pack\miles_google_connector_pack\CONNECTORS\GOOGLE\calendar.js |
| contacts | 2 | CONNECTORS\GOOGLE\contacts.js<br>CONNECTORS\GOOGLE\miles_google_connector_pack\miles_google_connector_pack\CONNECTORS\GOOGLE\contacts.js |
| drive | 2 | CONNECTORS\GOOGLE\drive.js<br>CONNECTORS\GOOGLE\miles_google_connector_pack\miles_google_connector_pack\CONNECTORS\GOOGLE\drive.js |
| gmail | 2 | CONNECTORS\GOOGLE\gmail.js<br>CONNECTORS\GOOGLE\miles_google_connector_pack\miles_google_connector_pack\CONNECTORS\GOOGLE\gmail.js |

## Generated Files

- miles_code_index.json
- miles_code_index.csv
- miles_code_index_summary.json
- dependency_edges.json
- duplicate_candidates.json
- capability_candidates.json

## Interpretation

- Active candidate does not automatically mean the module is used at runtime.
- A reference count of zero does not prove dead code because MILES performs dynamic loading.
- Duplicate names are review candidates, not automatic deletion candidates.
- The index intentionally excludes node_modules, legacy builds, references, backups, reports and generated registries.
