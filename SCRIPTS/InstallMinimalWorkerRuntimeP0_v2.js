"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT || process.cwd();
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/^\uFEFF/, "");
}

function backupAndWrite(rel, text) {
  const file = path.join(ROOT, rel);
  const backup = file + ".BEFORE_MINIMAL_RUNTIME_V2_" + stamp;
  if (fs.existsSync(file)) fs.copyFileSync(file, backup);
  fs.writeFileSync(file, text, "utf8");
  console.log("[MINIMAL V2] " + rel);
  console.log("             backup=" + backup);
}

function replaceOnce(text, re, replacement, label) {
  const matches = text.match(re);
  if (!matches) throw new Error("Minimal runtime V2 could not locate: " + label);
  return text.replace(re, replacement);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const supervisor = [
  '"use strict";',
  '',
  'const connectorManager = require("./ConnectorManager");',
  'const taskQueue = require("./TaskQueue");',
  'const workforceService = require("../SERVICES/WorkforceService");',
  'const { buildExecutiveState } = require("./STATE/ExecutiveState");',
  '',
  'function lazyConnector(modulePath) {',
  '  let implementation = null;',
  '  function load() {',
  '    if (!implementation) implementation = require(modulePath);',
  '    return implementation;',
  '  }',
  '  return {',
  '    healthCheck(...args) {',
  '      const target = load();',
  '      return typeof target.healthCheck === "function"',
  '        ? target.healthCheck(...args)',
  '        : { ok: true, status: "AVAILABLE" };',
  '    },',
  '    execute(...args) {',
  '      const target = load();',
  '      if (typeof target.execute !== "function") {',
  '        throw new Error("Connector does not implement execute(): " + modulePath);',
  '      }',
  '      return target.execute(...args);',
  '    }',
  '  };',
  '}',
  '',
  'class Supervisor {',
  '  constructor() {',
  '    this.running = false;',
  '    this.interval = null;',
  '    this.lastState = null;',
  '  }',
  '',
  '  async registerConnectors() {',
  '    const connectors = [',
  '      ["INSTANTLY", "../CONNECTORS/INSTANTLY/connector"],',
  '      ["ORION", "../CONNECTORS/ORION/connector"],',
  '      ["MILES", "../CONNECTORS/MILES/connector"]',
  '    ];',
  '    for (const [name, connectorPath] of connectors) {',
  '      try {',
  '        if (!connectorManager.get(name)) {',
  '          connectorManager.register(name, lazyConnector(connectorPath));',
  '        }',
  '      } catch (error) {',
  '        console.warn("[Supervisor] " + name + " lazy registration failed: " + error.message);',
  '      }',
  '    }',
  '  }',
  '',
  '  async heartbeat() {',
  '    try {',
  '      const queue = taskQueue.getStatus();',
  '      const workforceRaw = workforceService.status();',
  '      const connectorNames = connectorManager.list();',
  '      const connectors = {};',
  '      for (const name of connectorNames) {',
  '        connectors[name] = { name, ok: true, healthy: null, status: "REGISTERED_LAZY" };',
  '      }',
  '      const workforce = {',
  '        ok: workforceRaw.ok !== false,',
  '        workers: workforceRaw.employees || 0,',
  '        employees: workforceRaw.employees || 0,',
  '        capabilities: workforceRaw.capabilities || 0,',
  '        active: 0,',
  '        idle: workforceRaw.employees || 0,',
  '        queued: queue.pending || 0,',
  '        registryPath: workforceRaw.registryPath || null',
  '      };',
  '      this.lastState = buildExecutiveState({',
  '        connectors,',
  '        queue,',
  '        workforce,',
  '        capabilities: { ok: workforce.ok, count: workforce.capabilities, available: [] },',
  '        workflow: { ok: true, status: "ON_DEMAND" },',
  '        recovery: { total: queue.failed || 0, waiting: queue.failed || 0, retrying: 0, blocked: 0, byType: {} }',
  '      });',
  '      console.log("[MILES] SUPERVISOR HEARTBEAT | health=" + this.lastState.health.overall + " connectors=" + connectorNames.length + " workers=" + workforce.workers + " pending=" + (queue.pending || 0) + " running=" + (queue.running || 0) + " failed=" + (queue.failed || 0));',
  '      return this.lastState;',
  '    } catch (error) {',
  '      console.error("[Supervisor] HEARTBEAT FAILED", error);',
  '      return { ok: false, error: error.message };',
  '    }',
  '  }',
  '',
  '  async start(intervalMs = 60000) {',
  '    if (this.running) return;',
  '    this.running = true;',
  '    console.log("[MILES] Minimal supervisor starting");',
  '    await this.registerConnectors();',
  '    await this.heartbeat();',
  '    this.interval = setInterval(() => {',
  '      this.heartbeat().catch(error => console.error("[Supervisor] HEARTBEAT FAILED", error));',
  '    }, intervalMs);',
  '  }',
  '',
  '  stop() {',
  '    if (this.interval) clearInterval(this.interval);',
  '    this.interval = null;',
  '    this.running = false;',
  '    console.log("[MILES] Minimal supervisor stopped");',
  '  }',
  '}',
  '',
  'module.exports = new Supervisor();',
  ''
].join("\n");

// Prepare all transforms in memory first. Nothing is written unless all anchors resolve.
let router = read("SERVICES/ProviderRouterService.js");
router = replaceOnce(
  router,
  /const MarketingProvider =[\s\S]*?require\("\.\.\/PROVIDERS\/providers\/GoogleWorkspaceProvider"\);/,
  'const PROVIDER_LOADERS = Object.freeze({\n  MarketingProvider: () => require("../PROVIDERS/providers/MarketingProvider"),\n  OrionProvider: () => require("../PROVIDERS/providers/OrionProvider"),\n  WebsiteProvider: () => require("../PROVIDERS/providers/WebsiteProvider"),\n  SalesProvider: () => require("../PROVIDERS/providers/SalesProvider"),\n  GoogleWorkspaceProvider: () => require("../PROVIDERS/providers/GoogleWorkspaceProvider")\n});',
  "ProviderRouter eager provider requires"
);
router = replaceOnce(
  router,
  /this\.providers = \{\s*MarketingProvider,\s*OrionProvider,\s*WebsiteProvider,\s*SalesProvider,\s*GoogleWorkspaceProvider\s*\};/,
  'this.providers = Object.fromEntries(\n      Object.keys(PROVIDER_LOADERS).map(name => [name, true])\n    );',
  "ProviderRouter provider registry"
);
router = replaceOnce(
  router,
  /const ProviderClass =\s*this\.providers\[\s*providerName\s*\];\s*\n\s*if \(!ProviderClass\) \{/,
  'const providerLoader = PROVIDER_LOADERS[providerName];\n\n    if (!providerLoader) {',
  "ProviderRouter provider loader lookup"
);
router = replaceOnce(
  router,
  /const provider =\s*new ProviderClass\(\);/,
  'const ProviderClass = providerLoader();\n\n    const provider = new ProviderClass();',
  "ProviderRouter provider construction"
);

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
for (const pair of lazyTargets) {
  const name = pair[0];
  const modulePath = pair[1];
  const re = new RegExp('const ' + escapeRegExp(name) + ' =\\s*require\\(\\"' + escapeRegExp(modulePath) + '\\"\\);');
  worker = replaceOnce(worker, re, 'const ' + name + ' = lazyModule("' + modulePath + '");', "lazy " + name);
}
worker = replaceOnce(
  worker,
  /const eventBus =\s*safeRequire\(\s*"\.\/event-bus\/emitter"\s*\);/,
  'const eventBus = lazyModule("./event-bus/emitter");',
  "lazy eventBus"
);
worker = replaceOnce(
  worker,
  /function safeRequire\([\s\S]*?\n\}\n\nfunction delay/,
  'function safeRequire(modulePath) {\n  try { return require(modulePath); } catch { return null; }\n}\n\nfunction lazyModule(modulePath) {\n  let loaded = null;\n  return new Proxy({}, {\n    get(_target, property) {\n      if (!loaded) loaded = require(modulePath);\n      const value = loaded[property];\n      return typeof value === "function" ? value.bind(loaded) : value;\n    }\n  });\n}\n\nfunction compactResult(result) {\n  if (!result || typeof result !== "object") return result == null ? null : String(result);\n  return {\n    ok: result.ok === true,\n    status: result.status || null,\n    message: result.message || null,\n    taskId: result.taskId || result.id || null,\n    generatedAt: result.generatedAt || result.createdAt || null\n  };\n}\n\nfunction compactResolution(result, countKey) {\n  if (!result || typeof result !== "object") return { ok: false };\n  const compact = { ok: result.ok === true, checkedAt: result.checkedAt || null };\n  if (countKey) compact.count = Number(result[countKey] || 0);\n  return compact;\n}\n\nfunction delay',
  "minimal runtime helper insertion"
);
worker = replaceOnce(
  worker,
  /  buildStatus\(\) \{[\s\S]*?\n  \}\n\n  persistStatus\(\) \{/,
  '  buildStatus() {\n    const memory = process.memoryUsage();\n    return {\n      ok: this.started && !this.shuttingDown,\n      service: "RuntimeWorkerSupervisor",\n      type: "MILES_MINIMAL_WORKER_RUNTIME",\n      generatedAt: now(),\n      root: ROOT,\n      pid: process.pid,\n      nodeVersion: process.version,\n      memory: { rssMb: Math.round(memory.rss / 1048576), heapUsedMb: Math.round(memory.heapUsed / 1048576), heapTotalMb: Math.round(memory.heapTotal / 1048576) },\n      intervals: { execution: EXECUTION_INTERVAL_MS, heartbeat: HEARTBEAT_INTERVAL_MS, infrastructureHealth: HEALTH_INTERVAL_MS, autonomousWorkGeneration: WORK_GENERATION_INTERVAL_MS },\n      lifecycle: { started: this.started, shuttingDown: this.shuttingDown, executionPassRunning: this.executionPassRunning, healthCycleRunning: this.healthCycleRunning, workGenerationRunning: this.workGenerationRunning },\n      queue: queueCounts(),\n      metrics: {\n        pid: this.metrics.pid, startedAt: this.metrics.startedAt, stoppedAt: this.metrics.stoppedAt,\n        executionPasses: this.metrics.executionPasses, executionPassesSkipped: this.metrics.executionPassesSkipped, completed: this.metrics.completed, failed: this.metrics.failed, awaitingApproval: this.metrics.awaitingApproval, emptyQueuePasses: this.metrics.emptyQueuePasses,\n        healthCycles: this.metrics.healthCycles, healthCycleFailures: this.metrics.healthCycleFailures, workGenerationCycles: this.metrics.workGenerationCycles, workGenerationFailures: this.metrics.workGenerationFailures, heartbeatCount: this.metrics.heartbeatCount,\n        lastExecutionStartedAt: this.metrics.lastExecutionStartedAt, lastExecutionCompletedAt: this.metrics.lastExecutionCompletedAt, lastExecutionDurationMs: this.metrics.lastExecutionDurationMs, lastExecutionTaskId: this.metrics.lastExecutionTaskId, lastExecutionResult: compactResult(this.metrics.lastExecutionResult),\n        lastHealthCycleAt: this.metrics.lastHealthCycleAt, lastHealthResult: compactResult(this.metrics.lastHealthResult), lastWorkGenerationAt: this.metrics.lastWorkGenerationAt, lastWorkGenerationResult: compactResult(this.metrics.lastWorkGenerationResult), lastHeartbeatAt: this.metrics.lastHeartbeatAt,\n        lastError: this.metrics.lastError ? { area: this.metrics.lastError.area || null, message: this.metrics.lastError.message || null, createdAt: this.metrics.lastError.createdAt || null } : null\n      },\n      resolutionHealth: this.resolutionHealth\n    };\n  }\n\n  persistStatus() {',
  "compact buildStatus"
);
worker = worker.replace(/this\.metrics\s*\.lastExecutionResult =\s*result;/g, 'this.metrics.lastExecutionResult = compactResult(result);');
worker = worker.replace(/this\.metrics\s*\.lastWorkGenerationResult = \{[\s\S]*?\n      \};/, 'this.metrics.lastWorkGenerationResult = compactResult(result);');
worker = replaceOnce(
  worker,
  /this\.resolutionHealth = \{[\s\S]*?\n    \};\n\n    if \(\s*!this\.resolutionHealth\.ok\s*\)/,
  'this.resolutionHealth = {\n      ok: providerResolution.ok === true && capabilityResolution.ok === true && connectorResolution.ok === true && routingResolution.ok === true,\n      providerRegistry: compactResolution(providerResolution, "providerCount"),\n      capabilityRegistry: compactResolution(capabilityResolution, "capabilityCount"),\n      connectorRegistry: compactResolution(connectorResolution, "connectorCount"),\n      routing: compactResolution(routingResolution),\n      checkedAt: now()\n    };\n\n    if (!this.resolutionHealth.ok)',
  "compact resolution health"
);
worker = worker.replace(/\n\s*credentialAuthority\.scan\(\);\s*\n\s*infrastructureRegistry\.summary\(\);/m, '\n\n    // Heavy credential/infrastructure scans are deferred until explicitly needed.');
worker = replaceOnce(
  worker,
  /  startInfrastructureHealthLoop\(\) \{[\s\S]*?\n  \}\n\n  startAutonomousWorkLoop\(\) \{/,
  '  startInfrastructureHealthLoop() {\n    console.log("[MILES] Infrastructure health scheduled; startup execution deferred.");\n    this.healthTimer = setInterval(() => {\n      this.runInfrastructureHealthCycle().catch(error => console.error("[MILES] INFRASTRUCTURE HEALTH LOOP ERROR", error));\n    }, HEALTH_INTERVAL_MS);\n  }\n\n  startAutonomousWorkLoop() {',
  "defer infrastructure health"
);
worker = replaceOnce(
  worker,
  /  startAutonomousWorkLoop\(\) \{[\s\S]*?\n  \}\n\n  async boot\(\) \{/,
  '  startAutonomousWorkLoop() {\n    console.log("[MILES] Autonomous work scheduled; startup execution deferred.");\n    this.workGenerationTimer = setInterval(() => {\n      try { this.runAutonomousWorkGenerationCycle(); } catch (error) { console.error("[MILES] AUTONOMOUS WORK LOOP ERROR", error); }\n    }, WORK_GENERATION_INTERVAL_MS);\n  }\n\n  async boot() {',
  "defer autonomous work"
);

// Only now write all three files.
backupAndWrite("CORE/Supervisor.js", supervisor);
backupAndWrite("SERVICES/ProviderRouterService.js", router);
backupAndWrite("StartProductionSystem.js", worker);

console.log("=== MILES MINIMAL WORKER RUNTIME P0 V2 INSTALLED ===");
console.log("Minimal heartbeat + lazy connectors/providers/subsystems + compact retained state + deferred heavy startup cycles");
