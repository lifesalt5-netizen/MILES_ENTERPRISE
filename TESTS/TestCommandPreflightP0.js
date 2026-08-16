"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const CommandPreflightService = require("../SERVICES/governance/CommandPreflightService");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "miles-command-preflight-"));
const runtime = path.join(tempRoot, "DATA", "runtime");
const config = path.join(tempRoot, "CONFIG");
fs.mkdirSync(runtime, { recursive: true });
fs.mkdirSync(config, { recursive: true });

const critical = ["CORE/TaskQueue.js", "SERVICES/BusinessOperationsBridgeService.js"];
for (const file of critical) {
  const target = path.join(tempRoot, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, "module.exports = {};\n", "utf8");
}
fs.writeFileSync(path.join(config, "PRODUCTION_SYSTEM_GRAPH.json"), JSON.stringify({ criticalModules: critical }, null, 2));
fs.writeFileSync(path.join(runtime, "task_queue.json"), "[]", "utf8");

let currentTime = Date.now();
fs.writeFileSync(path.join(runtime, "worker_runtime_status.json"), JSON.stringify({
  generatedAt: new Date(currentTime).toISOString(),
  pid: 1234,
  lifecycle: { started: true, shuttingDown: false },
  memory: { rssMb: 200 },
  queue: { total: 0, queued: 0, running: 0 }
}, null, 2));

function authority({ instantlyRead = true, instantlyWrite = false } = {}) {
  return {
    run() {
      return {
        ok: true,
        providers: [
          {
            key: "instantly",
            provider: "instantly",
            status: instantlyRead ? (instantlyWrite ? "READY" : "READY_READ_ONLY") : "MISSING_CREDENTIALS",
            credentialsPresent: instantlyRead,
            credentials: { missingEnv: instantlyRead ? [] : ["INSTANTLY_API_KEY"] },
            capabilities: {
              read: { enabled: instantlyRead },
              write: { enabled: instantlyWrite, flag: "INSTANTLY_WRITE_ENABLED" }
            }
          }
        ]
      };
    }
  };
}

function makeService(options = {}) {
  return new CommandPreflightService({
    rootDir: tempRoot,
    providerAuthority: options.providerAuthority || authority(),
    queueMaxBytes: options.queueMaxBytes || 1024 * 1024,
    workerMaxAgeMs: options.workerMaxAgeMs || 120000,
    now: () => currentTime
  });
}

function expect(condition, message, detail) {
  if (!condition) throw new Error(`${message}${detail ? ` :: ${JSON.stringify(detail)}` : ""}`);
  console.log(`[PASS] ${message}`);
}

try {
  const internal = makeService().evaluate({
    operation: {
      id: "op_internal",
      source: "MILES_COMMAND_CENTER",
      provider: "MILES",
      connector: "MILES",
      action: "BUSINESS_EXECUTION",
      command: "Review the current P2GC revenue pipeline and report the top 3 actions. Read-only. Do not send or modify anything."
    },
    task: { type: "BUSINESS_EXECUTION", payload: {} }
  });
  expect(internal.ok && internal.allowedToQueue && internal.writeRequested === false, "read-only CEO mission preflights green", internal);

  const instantlyRead = makeService().evaluate({
    operation: {
      id: "op_instantly_read",
      source: "MILES_COMMAND_CENTER",
      provider: "INSTANTLY",
      connector: "INSTANTLY",
      action: "INSTANTLY_LIVE",
      command: "Review Instantly campaign health and report results only."
    },
    task: { type: "INSTANTLY_LIVE", payload: {} }
  });
  expect(instantlyRead.ok && instantlyRead.providers.includes("instantly"), "Instantly read command requires and passes canonical provider authority", instantlyRead);

  const instantlyMissing = makeService({ providerAuthority: authority({ instantlyRead: false }) }).evaluate({
    operation: {
      id: "op_instantly_missing",
      source: "MILES_COMMAND_CENTER",
      provider: "INSTANTLY",
      connector: "INSTANTLY",
      action: "INSTANTLY_LIVE",
      command: "Review Instantly campaign health and report results only."
    },
    task: { type: "INSTANTLY_LIVE", payload: {} }
  });
  expect(!instantlyMissing.ok && instantlyMissing.blockers.some(x => x.code === "PROVIDER_READ_BLOCKED"), "missing external credential blocks before queueing", instantlyMissing.blockers);

  const writeGoverned = makeService({ providerAuthority: authority({ instantlyRead: true, instantlyWrite: false }) }).evaluate({
    operation: {
      id: "op_instantly_write",
      source: "MILES_COMMAND_CENTER",
      provider: "INSTANTLY",
      connector: "INSTANTLY",
      action: "ACTIVATE_CAMPAIGN",
      command: "Activate the approved Instantly campaign."
    },
    task: { type: "ACTIVATE_CAMPAIGN", payload: {} }
  });
  expect(!writeGoverned.ok && writeGoverned.blockers.some(x => x.code === "PROVIDER_WRITE_GOVERNED"), "external write remains blocked when provider write authority is disabled", writeGoverned.blockers);

  const approval = makeService({ providerAuthority: authority({ instantlyRead: true, instantlyWrite: true }) }).evaluate({
    operation: {
      id: "op_approval",
      source: "MILES_COMMAND_CENTER",
      provider: "MILES",
      connector: "MILES",
      action: "CHANGE_PRICING",
      approvalRequired: true,
      command: "Change our pricing."
    },
    task: { type: "CHANGE_PRICING", payload: {} }
  });
  expect(!approval.ok && approval.blockers.some(x => x.code === "CEO_APPROVAL_REQUIRED"), "protected CEO action cannot enter TaskQueue before approval", approval.blockers);

  fs.writeFileSync(path.join(runtime, "task_queue.json"), Buffer.alloc(2 * 1024 * 1024, 32));
  const oversized = makeService({ queueMaxBytes: 1024 * 1024 }).evaluate({
    operation: {
      id: "op_queue",
      source: "MILES_COMMAND_CENTER",
      provider: "MILES",
      connector: "MILES",
      action: "BUSINESS_EXECUTION",
      command: "Review the revenue pipeline only."
    },
    task: { type: "BUSINESS_EXECUTION", payload: {} }
  });
  expect(!oversized.ok && oversized.blockers.some(x => x.code === "QUEUE_MAINTENANCE_REQUIRED"), "oversized active queue blocks command before lock contention", oversized.blockers);

  fs.writeFileSync(path.join(runtime, "task_queue.json"), "[]", "utf8");
  currentTime += 300000;
  const staleWorker = makeService({ workerMaxAgeMs: 120000 }).evaluate({
    operation: {
      id: "op_stale_worker",
      source: "MILES_COMMAND_CENTER",
      provider: "MILES",
      connector: "MILES",
      action: "BUSINESS_EXECUTION",
      command: "Review the revenue pipeline only."
    },
    task: { type: "BUSINESS_EXECUTION", payload: {} }
  });
  expect(!staleWorker.ok && staleWorker.blockers.some(x => x.code === "WORKER_STATUS_STALE"), "stale worker telemetry blocks CEO command before queueing", staleWorker.blockers);

  const nonCEO = makeService().evaluate({
    operation: { id: "internal_1", source: "internal_scheduler", provider: "MILES" },
    task: { type: "STATUS", payload: {} }
  });
  expect(nonCEO.ok && nonCEO.status === "PREFLIGHT_NOT_REQUIRED_FOR_SOURCE", "non-CEO internal work remains backward compatible", nonCEO);

  console.log("=== CEO COMMAND PREFLIGHT P0 PASS ===");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
