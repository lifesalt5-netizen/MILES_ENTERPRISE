"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT || process.cwd();
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/^\uFEFF/, "");
}

function write(rel, text) {
  const file = path.join(ROOT, rel);
  const backup = `${file}.BEFORE_MINIMAL_RUNTIME_${stamp}`;
  if (fs.existsSync(file)) fs.copyFileSync(file, backup);
  fs.writeFileSync(file, text, "utf8");
  console.log(`[MINIMAL] ${rel}`);
  console.log(`          backup=${backup}`);
}

function replaceOnce(text, re, replacement, label) {
  const next = text.replace(re, replacement);
  if (next === text) throw new Error(`Minimal runtime migration could not locate: ${label}`);
  return next;
}

// 1) Supervisor: replace the eager, expensive heartbeat with a bounded heartbeat.
const supervisor = `"use strict";

const connectorManager = require("./ConnectorManager");
const taskQueue = require("./TaskQueue");
const workforceService = require("../SERVICES/WorkforceService");
const { buildExecutiveState } = require("./STATE/ExecutiveState");

function lazyConnector(modulePath) {
  let implementation = null;
  function load() {
    if (!implementation) implementation = require(modulePath);
    return implementation;
  }
  return {
    healthCheck(...args) {
      const target = load();
      return typeof target.healthCheck === "function"
        ? target.healthCheck(...args)
        : { ok: true, status: "AVAILABLE" };
    },
    execute(...args) {
      const target = load();
      if (typeof target.execute !== "function") {
        throw new Error(`Connector does not implement execute(): ${modulePath}`);
      }
      return target.execute(...args);
    }
  };
}

class Supervisor {
  constructor() {
    this.running = false;
    this.interval = null;
    this.lastState = null;
  }

  async registerConnectors() {
    const connectors = [
      ["INSTANTLY", "../CONNECTORS/INSTANTLY/connector"],
      ["ORION", "../CONNECTORS/ORION/connector"],
      ["MILES", "../CONNECTORS/MILES/connector"]
    ];

    for (const [name, connectorPath] of connectors) {
      try {
        if (!connectorManager.get(name)) {
          connectorManager.register(name, lazyConnector(connectorPath));
        }
      } catch (error) {
        console.warn(`[Supervisor] ${name} lazy registration failed: ${error.message}`);
      }
    }
  }

  async heartbeat() {
    try {
      const queue = taskQueue.getStatus();
      const workforceRaw = workforceService.status();
      const connectorNames = connectorManager.list();
      const connectors = {};

      for (const name of connectorNames) {
        connectors[name] = {
          name,
          ok: true,
          healthy: null,
          status: "REGISTERED_LAZY"
        };
      }

      const workforce = {
        ok: workforceRaw.ok !== false,
        workers: workforceRaw.employees || 0,
        employees: workforceRaw.employees || 0,
        capabilities: workforceRaw.capabilities || 0,
        active: 0,
        idle: workforceRaw.employees || 0,
        queued: queue.pending || 0,
        registryPath: workforceRaw.registryPath || null
      };

      const capabilities = {
        ok: workforce.ok,
        count: workforce.capabilities,
        available: []
      };

      const workflow = {
        ok: true,
        status: "ON_DEMAND"
      };

      const recovery = {
        total: queue.failed || 0,
        waiting: queue.failed || 0,
        retrying: 0,
        blocked: 0,
        byType: {}
      };

      this.lastState = buildExecutiveState({
        connectors,
        queue,
        workforce,
        capabilities,
        workflow,
        recovery
      });

      console.log(
        `[MILES] SUPERVISOR HEARTBEAT | health=${this.lastState.health.overall} connectors=${connectorNames.length} workers=${workforce.workers} pending=${queue.pending || 0} running=${queue.running || 0} failed=${queue.failed || 0}`
      );

      return this.lastState;
    } catch (error) {
      console.error("[Supervisor] HEARTBEAT FAILED", error);
      return { ok: false, error: error.message };
    }
  }

  async start(intervalMs = 60000) {
    if (this.running) return;
    this.running = true;
    console.log("[MILES] Minimal supervisor starting");
    await this.registerConnectors();
    await this.heartbeat();
    this.interval = setInterval(() => {
      this.heartbeat().catch(error => console.error("[Supervisor] HEARTBEAT FAILED", error));
    }, intervalMs);
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    this.running = false;
    console.log("[MILES] Minimal supervisor stopped");
  }
}

module.exports = new Supervisor();
`;
write("CORE/Supervisor.js", supervisor);

// 2) ProviderRouter: provider classes load only on the first task that needs them.
let router = read("SERVICES/ProviderRouterService.js");
router = replaceOnce(
  router,
  /const MarketingProvider =[\s\S]*?require\("\.\.\/PROVIDERS\/providers\/GoogleWorkspaceProvider"\);/,
  `const PROVIDER_LOADERS = Object.freeze({\n  MarketingProvider: () => require("../PROVIDERS/providers/MarketingProvider"),\n  OrionProvider: () => require("../PROVIDERS/providers/OrionProvider"),\n  WebsiteProvider: () => require("../PROVIDERS/providers/WebsiteProvider"),\n  SalesProvider: () => require("../PROVIDERS/providers/SalesProvider"),\n  GoogleWorkspaceProvider: () => require("../PROVIDERS/providers/GoogleWorkspaceProvider")\n});`,
  "ProviderRouter eager provider requires"
);
router = replaceOnce(
  router,
  /this\.providers = \{\s*MarketingProvider,\s*OrionProvider,\s*WebsiteProvider,\s*SalesProvider,\s*GoogleWorkspaceProvider\s*\};/,
  `this.providers = Object.fromEntries(\n      Object.keys(PROVIDER_LOADERS).map(name => [name, true])\n    );`,
  "ProviderRouter provider registry"
);
router = replaceOnce(
  router,
  /const ProviderClass =\s*this\.providers\[\s*providerName\s*\];\s*\n\s*if \(!ProviderClass\) \{/,
  `const providerLoader = PROVIDER_LOADERS[providerName];\n\n    if (!providerLoader) {`,
  "ProviderRouter provider class lookup"
);
router = replaceOnce(
  router,
  /const provider =\s*new ProviderClass\(\);/,
  `const ProviderClass = providerLoader();\n\n    const provider = new ProviderClass();`,
  "ProviderRouter provider construction"
);
write("SERVICES/ProviderRouterService.js", router);

// 3) Worker runtime: lazy subsystem modules, bounded state, no heavy immediate startup cycles.
let worker = read("StartProductionSystem.js");
const lazyTargets = [
  ["supervisor", "./CORE/Supervisor"],
  ["executionService", "./SERVICES/ExecutionService"],
  ["infrastructureRegistry", "./SERVICES/InfrastructureRegistryService"],
  ["credentialAuthority", "./SERVICES/CredentialAuthorityService"],
  ["infrastructureHealthManager", "./SERVICES/InfrastructureHealthManagerService"],
  ["autonomousWorkGenerator", "./SERVICES/AutonomousWorkGenerationService"],
  ["providerRouter", "./SERVICES/ProviderRouterService"],
  ["connectorManager", "./CORE/ConnectorManager"],
  ["capabilityService", "./SERVICES/CapabilityService"],
  ["capabilityDispatcher", "./SERVICES/CapabilityDispatcherService"]
];

for (const [name, modulePath] of lazyTargets) {
  const re = new RegExp(`const ${name} =\\s*require\\(\\"${modulePath.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\"\\);`);
  worker = replaceOnce(worker, re, `const ${name} = lazyModule("${modulePath}");`, `lazy ${name}`);
}
worker = replaceOnce(
  worker,
  /const eventBus =\s*safeRequire\(\s*"\.\/event-bus\/emitter"\s*\);/,
  `const eventBus = lazyModule("./event-bus/emitter");`,
  "lazy eventBus"
);
worker = replaceOnce(
  worker,
  /function safeRequire\([\s\S]*?\n\}\n\nfunction delay/,
  `function safeRequire(modulePath) {\n  try { return require(modulePath); } catch { return null; }\n}\n\nfunction lazyModule(modulePath) {\n  let loaded = null;\n  return new Proxy({}, {\n    get(_target, property) {\n      if (!loaded) loaded = require(modulePath);\n      const value = loaded[property];\n      return typeof value === "function" ? value.bind(loaded) : value;\n    }\n  });\n}\n\nfunction compactResult(result) {\n  if (!result || typeof result !== "object") return result == null ? null : String(result);\n  return {\n    ok: result.ok === true,\n    status: result.status || null,\n    message: result.message || null,\n    taskId: result.taskId || result.id || null,\n    generatedAt: result.generatedAt || result.createdAt || null\n  };\n}\n\nfunction compactResolution(result, countKey) {\n  if (!result || typeof result !== "object") return { ok: false };\n  return {\n    ok: result.ok === true,\n    count: countKey ? Number(result[countKey] || 0) : undefined,\n    checkedAt: result.checkedAt || null\n  };\n}\n\nfunction delay`,
  "lazy-module helpers"
);

worker = replaceOnce(
  worker,
  /  buildStatus\(\) \{[\s\S]*?\n  \}\n\n  persistStatus\(\) \{/,
  `  buildStatus() {\n    const memory = process.memoryUsage();\n    return {\n      ok: this.started && !this.shuttingDown,\n      service: "RuntimeWorkerSupervisor",\n      type: "MILES_MINIMAL_WORKER_RUNTIME",\n      generatedAt: now(),\n      root: ROOT,\n      pid: process.pid,\n      nodeVersion: process.version,\n      memory: {\n        rssMb: Math.round(memory.rss / 1048576),\n        heapUsedMb: Math.round(memory.heapUsed / 1048576),\n        heapTotalMb: Math.round(memory.heapTotal / 1048576)\n      },\n      intervals: {\n        execution: EXECUTION_INTERVAL_MS,\n        heartbeat: HEARTBEAT_INTERVAL_MS,\n        infrastructureHealth: HEALTH_INTERVAL_MS,\n        autonomousWorkGeneration: WORK_GENERATION_INTERVAL_MS\n      },\n      lifecycle: {\n        started: this.started,\n        shuttingDown: this.shuttingDown,\n        executionPassRunning: this.executionPassRunning,\n        healthCycleRunning: this.healthCycleRunning,\n        workGenerationRunning: this.workGenerationRunning\n      },\n      queue: queueCounts(),\n      metrics: {\n        pid: this.metrics.pid,\n        startedAt: this.metrics.startedAt,\n        stoppedAt: this.metrics.stoppedAt,\n        executionPasses: this.metrics.executionPasses,\n        executionPassesSkipped: this.metrics.executionPassesSkipped,\n        completed: this.metrics.completed,\n        failed: this.metrics.failed,\n        awaitingApproval: this.metrics.awaitingApproval,\n        emptyQueuePasses: this.metrics.emptyQueuePasses,\n        healthCycles: this.metrics.healthCycles,\n        healthCycleFailures: this.metrics.healthCycleFailures,\n        workGenerationCycles: this.metrics.workGenerationCycles,\n        workGenerationFailures: this.metrics.workGenerationFailures,\n        heartbeatCount: this.metrics.heartbeatCount,\n        lastExecutionStartedAt: this.metrics.lastExecutionStartedAt,\n        lastExecutionCompletedAt: this.metrics.lastExecutionCompletedAt,\n        lastExecutionDurationMs: this.metrics.lastExecutionDurationMs,\n        lastExecutionTaskId: this.metrics.lastExecutionTaskId,\n        lastExecutionResult: compactResult(this.metrics.lastExecutionResult),\n        lastHealthCycleAt: this.metrics.lastHealthCycleAt,\n        lastHealthResult: compactResult(this.metrics.lastHealthResult),\n        lastWorkGenerationAt: this.metrics.lastWorkGenerationAt,\n        lastWorkGenerationResult: compactResult(this.metrics.lastWorkGenerationResult),\n        lastHeartbeatAt: this.metrics.lastHeartbeatAt,\n        lastError: this.metrics.lastError\n          ? { area: this.metrics.lastError.area || null, message: this.metrics.lastError.message || null, createdAt: this.metrics.lastError.createdAt || null }\n          : null\n      },\n      resolutionHealth: this.resolutionHealth\n    };\n  }\n\n  persistStatus() {`,
  "compact buildStatus"
);
worker = worker.replace(/this\.metrics\s*\.lastExecutionResult =\s*result;/g, "this.metrics.lastExecutionResult = compactResult(result);");
worker = worker.replace(/this\.metrics\s*\.lastWorkGenerationResult = \{[\s\S]*?\n      \};/, "this.metrics.lastWorkGenerationResult = compactResult(result);");
worker = replaceOnce(
  worker,
  /this\.resolutionHealth = \{[\s\S]*?\n    \};\n\n    if \(\s*!this\.resolutionHealth\.ok\s*\)/,
  `this.resolutionHealth = {\n      ok: providerResolution.ok === true && capabilityResolution.ok === true && connectorResolution.ok === true && routingResolution.ok === true,\n      providerRegistry: compactResolution(providerResolution, "providerCount"),\n      capabilityRegistry: compactResolution(capabilityResolution, "capabilityCount"),\n      connectorRegistry: compactResolution(connectorResolution, "connectorCount"),\n      routing: compactResolution(routingResolution),\n      checkedAt: now()\n    };\n\n    if (!this.resolutionHealth.ok)`,
  "compact resolutionHealth"
);
worker = worker.replace(/\n\s*credentialAuthority\.scan\(\);\s*\n\s*infrastructureRegistry\.summary\(\);/m, "\n\n    // Heavy credential/infrastructure scans are on-demand after boot.");
worker = replaceOnce(
  worker,
  /  startInfrastructureHealthLoop\(\) \{[\s\S]*?\n  \}\n\n  startAutonomousWorkLoop\(\) \{/,
  `  startInfrastructureHealthLoop() {\n    console.log(\`[MILES] Infrastructure health scheduled (${HEALTH_INTERVAL_MS} ms; deferred startup).\`);\n    this.healthTimer = setInterval(() => {\n      this.runInfrastructureHealthCycle().catch(error =>\n        console.error("[MILES] INFRASTRUCTURE HEALTH LOOP ERROR", error)\n      );\n    }, HEALTH_INTERVAL_MS);\n  }\n\n  startAutonomousWorkLoop() {`,
  "defer infrastructure health startup"
);
worker = replaceOnce(
  worker,
  /  startAutonomousWorkLoop\(\) \{[\s\S]*?\n  \}\n\n  async boot\(\) \{/,
  `  startAutonomousWorkLoop() {\n    console.log(\`[MILES] Autonomous work scheduled (${WORK_GENERATION_INTERVAL_MS} ms; deferred startup).\`);\n    this.workGenerationTimer = setInterval(() => {\n      try { this.runAutonomousWorkGenerationCycle(); }\n      catch (error) { console.error("[MILES] AUTONOMOUS WORK LOOP ERROR", error); }\n    }, WORK_GENERATION_INTERVAL_MS);\n  }\n\n  async boot() {`,
  "defer autonomous work startup"
);
write("StartProductionSystem.js", worker);

console.log("=== MILES MINIMAL WORKER RUNTIME P0 INSTALLED ===");
console.log("Changes: minimal Supervisor + lazy ProviderRouter + compact/lazy worker runtime");
console.log("Next: node --check CORE/Supervisor.js SERVICES/ProviderRouterService.js StartProductionSystem.js");
