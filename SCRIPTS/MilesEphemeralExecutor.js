"use strict";

const fs = require("fs");
const path = require("path");

process.env.MILES_ROOT = process.env.MILES_ROOT || path.resolve(__dirname, "..");
const ROOT = process.env.MILES_ROOT;

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
  return {
    ok: result.ok === true,
    count: countKey ? Number(result[countKey] || 0) : null,
    checkedAt: result.checkedAt || null
  };
}

async function executeTask(input) {
  const executionService = require("../SERVICES/ExecutionService");
  if (!input || !input.task) throw new Error("Ephemeral executor requires input.task");
  return executionService.execute(input.task);
}

async function validateRuntime() {
  const providerRouter = require("../SERVICES/ProviderRouterService");
  const connectorManager = require("../CORE/ConnectorManager");
  const capabilityService = require("../SERVICES/CapabilityService");
  const capabilityDispatcher = require("../SERVICES/CapabilityDispatcherService");

  const providerResolution = providerRouter.validateRegistry();
  const connectorResolution = connectorManager.validateAll();
  const capabilityResolution =
    typeof capabilityService.validateCapabilities === "function"
      ? capabilityService.validateCapabilities()
      : capabilityService.buildGraph();
  const routingResolution =
    typeof capabilityDispatcher.status === "function"
      ? capabilityDispatcher.status()
      : { ok: true };

  return {
    ok:
      providerResolution.ok === true &&
      capabilityResolution.ok === true &&
      connectorResolution.ok === true &&
      routingResolution.ok === true,
    providerRegistry: compactResolution(providerResolution, "providerCount"),
    capabilityRegistry: compactResolution(capabilityResolution, "capabilityCount"),
    connectorRegistry: compactResolution(connectorResolution, "connectorCount"),
    routing: compactResolution(routingResolution),
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
