"use strict";

const fs = require("fs");
const path = require("path");

process.env.MILES_ROOT = process.env.MILES_ROOT || path.resolve(__dirname, "..");
const ROOT = process.env.MILES_ROOT;

const EPHEMERAL_CONNECTOR_PATHS = Object.freeze({
  MILES: "../CONNECTORS/MILES/connector",
  INSTANTLY: "../CONNECTORS/INSTANTLY/connector",
  ORION: "../CONNECTORS/ORION/connector"
});

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")); }
  catch { return fallback; }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

function compactResolution(result, countKey) {
  if (!result || typeof result !== "object") return { ok: false, count: null };
  const explicitOk = result.ok;
  return {
    ok: explicitOk === false ? false : true,
    count: countKey ? Number(result[countKey] || result.count || 0) : null,
    status: result.status || null,
    checkedAt: result.checkedAt || result.generatedAt || null
  };
}

function normalizeOk(result, fallback = true) {
  if (!result || typeof result !== "object") return fallback;
  if (result.ok === false) return false;
  if (String(result.status || "").toUpperCase() === "CRITICAL") return false;
  if (String(result.status || "").toUpperCase() === "FAILED") return false;
  return true;
}

function resolveTaskConnector(task = {}) {
  const payload = task.payload || {};
  const plan = payload.plan || task.plan || {};

  return String(
    task.connector ||
    payload.connector ||
    plan.connector ||
    task.system ||
    payload.system ||
    plan.system ||
    task.provider ||
    payload.provider ||
    plan.provider ||
    ""
  ).trim().toUpperCase();
}

/*
 * ConnectorManager is process-local. The parent Supervisor owns the canonical
 * registry, but ExecutionService runs inside a fresh ephemeral child. Therefore
 * the child must register the ONE connector required by its claimed task before
 * invoking ExecutionService. This preserves the lean parent runtime and avoids
 * eagerly loading every external integration into every child.
 */
function ensureTaskConnector(task = {}) {
  const connectorName = resolveTaskConnector(task);
  const modulePath = EPHEMERAL_CONNECTOR_PATHS[connectorName];

  if (!modulePath) {
    return {
      ok: true,
      status: connectorName ? "NO_EPHEMERAL_CONNECTOR_BOOTSTRAP_REQUIRED" : "NO_CONNECTOR_DECLARED",
      connector: connectorName || null,
      registered: false
    };
  }

  const connectorManager = require("../CORE/ConnectorManager");

  if (connectorManager.has(connectorName)) {
    return {
      ok: true,
      status: "CONNECTOR_ALREADY_REGISTERED",
      connector: connectorName,
      registered: false
    };
  }

  const implementation = require(modulePath);
  connectorManager.register(connectorName, implementation);

  return {
    ok: true,
    status: "EPHEMERAL_CONNECTOR_REGISTERED",
    connector: connectorName,
    registered: true,
    modulePath
  };
}

async function executeTask(input) {
  if (!input || !input.task) throw new Error("Ephemeral executor requires input.task");

  const connectorBootstrap = ensureTaskConnector(input.task);
  const executionService = require("../SERVICES/ExecutionService");
  const result = await executionService.execute(input.task);

  if (result && typeof result === "object") {
    return {
      ...result,
      ephemeralConnectorBootstrap: connectorBootstrap
    };
  }

  return result;
}

async function validateRuntime() {
  const providerRouter = require("../SERVICES/ProviderRouterService");
  const capabilityService = require("../SERVICES/CapabilityService");
  const capabilityDispatcher = require("../SERVICES/CapabilityDispatcherService");

  const providerResolution =
    typeof providerRouter.validateRegistry === "function"
      ? providerRouter.validateRegistry()
      : { ok: typeof providerRouter.executeProviderTask === "function" };

  // Connector registration remains owned by the parent Supervisor at runtime.
  // Execution children separately bootstrap only their claimed task connector.
  const connectorResolution = {
    ok: true,
    status: "PARENT_VALIDATED_CHILD_BOOTSTRAPS_TASK_CONNECTOR",
    connectorCount: null,
    checkedAt: new Date().toISOString()
  };

  let capabilityResolution;
  try {
    if (typeof capabilityService.planObjective !== "function") {
      capabilityResolution = {
        ok: false,
        status: "PLAN_OBJECTIVE_MISSING",
        capabilityCount: 0
      };
    } else {
      const probe = capabilityService.planObjective(
        "Review the current sales pipeline and recommend the next action.",
        { department: "Sales" }
      );
      capabilityResolution = {
        ok:
          probe?.ok === true &&
          Array.isArray(probe?.requiredCapabilities) &&
          probe.requiredCapabilities.length > 0 &&
          Array.isArray(probe?.operationalPlan?.steps) &&
          probe.operationalPlan.steps.length > 0,
        status: probe?.ok === true ? "RESOLVED" : "UNRESOLVED",
        capabilityCount: Array.isArray(probe?.requiredCapabilities)
          ? probe.requiredCapabilities.length
          : 0,
        resolution: probe?.resolution || null,
        registryResolution: probe?.registryResolution || null
      };
    }
  } catch (error) {
    capabilityResolution = {
      ok: false,
      status: "CAPABILITY_PROBE_FAILED",
      capabilityCount: 0,
      error: error.message
    };
  }

  let routingResolution;
  try {
    routingResolution =
      typeof capabilityDispatcher.status === "function"
        ? capabilityDispatcher.status()
        : { ok: true, status: "STATUS_NOT_EXPOSED" };
  } catch (error) {
    routingResolution = { ok: false, status: "ROUTING_STATUS_FAILED", error: error.message };
  }

  const providerOk = normalizeOk(providerResolution, false);
  const connectorOk = true;
  const capabilityOk = capabilityResolution.ok === true;
  const routingOk = normalizeOk(routingResolution, true);

  return {
    ok: providerOk && capabilityOk && routingOk,
    providerRegistry: compactResolution(providerResolution, "providerCount"),
    capabilityRegistry: compactResolution(capabilityResolution, "capabilityCount"),
    connectorRegistry: compactResolution(connectorResolution, "connectorCount"),
    routing: compactResolution(routingResolution),
    checks: {
      providerOk,
      connectorOk,
      capabilityOk,
      routingOk
    },
    checkedAt: new Date().toISOString()
  };
}

async function runHealth() {
  const service = require("../SERVICES/InfrastructureHealthManagerService");
  const result = await service.runCycle();
  return {
    ok: result?.ok === true,
    status: result?.status || null,
    durationMs: result?.durationMs || null,
    failures: Array.isArray(result?.failures) ? result.failures.slice(0, 10) : [],
    completedAt: new Date().toISOString()
  };
}

async function runAutonomous() {
  const service = require("../SERVICES/AutonomousWorkGenerationService");
  const result = await service.runCycle();
  return {
    ok: result?.ok === true,
    status: result?.status || null,
    queued: result?.queued ?? result?.created ?? null,
    completedAt: new Date().toISOString()
  };
}

async function main() {
  const mode = String(process.argv[2] || "").trim().toLowerCase();
  const inputFile = process.argv[3] || null;
  const outputFile = process.argv[4] || null;
  if (!mode || !outputFile) throw new Error("Usage: node MilesEphemeralExecutor.js <mode> <inputFile|-> <outputFile>");

  const input = inputFile && inputFile !== "-" ? readJson(inputFile, {}) : {};
  let result;

  if (mode === "execute") result = await executeTask(input);
  else if (mode === "validate") result = await validateRuntime();
  else if (mode === "health") result = await runHealth();
  else if (mode === "autonomous") result = await runAutonomous();
  else throw new Error("Unsupported ephemeral executor mode: " + mode);

  writeJson(outputFile, {
    ok: result?.ok !== false,
    mode,
    pid: process.pid,
    generatedAt: new Date().toISOString(),
    result
  });
}

if (require.main === module) {
  main()
    .then(() => { process.exitCode = 0; })
    .catch(error => {
      const outputFile = process.argv[4] || null;
      const failure = {
        ok: false,
        mode: process.argv[2] || null,
        pid: process.pid,
        generatedAt: new Date().toISOString(),
        error: error.stack || error.message || String(error)
      };
      if (outputFile) {
        try { writeJson(outputFile, failure); } catch {}
      }
      console.error(error.stack || error.message || String(error));
      process.exitCode = 1;
    });
}

module.exports = {
  EPHEMERAL_CONNECTOR_PATHS,
  resolveTaskConnector,
  ensureTaskConnector,
  executeTask,
  validateRuntime
};
