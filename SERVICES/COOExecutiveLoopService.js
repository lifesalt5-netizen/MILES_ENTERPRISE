"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT || process.cwd();

const QUEUE_FILE = path.join(ROOT, "state", "business_operations_queue.json");
const EXEC_LOG = path.join(ROOT, "runtime", "coo_executive_loop_execution_log.jsonl");
const STATE_FILE = path.join(ROOT, "runtime", "coo_executive_loop_state.json");

function now() {
  return new Date().toISOString();
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  ensureDir(filePath);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function log(entry) {
  ensureDir(EXEC_LOG);
  fs.appendFileSync(EXEC_LOG, JSON.stringify({ ...entry, loggedAt: now() }) + "\n", "utf8");
}

class COOExecutiveLoopService {
  constructor(options = {}) {
    this.service = "COO_EXECUTIVE_LOOP_SERVICE";
    this.version = "1.0.0";
    this.rootDir = options.rootDir || ROOT;
    this.pollIntervalMs = Number(options.pollIntervalMs || 15000);
    this.running = false;
    this.timer = null;

    this.state = {
      ok: true,
      service: this.service,
      version: this.version,
      status: "INITIALIZED",
      startedAt: null,
      stoppedAt: null,
      cycleCount: 0,
      operationsClaimed: 0,
      operationsCompleted: 0,
      operationsFailed: 0,
      lastCycleAt: null,
      lastOperationId: null,
      lastError: null
    };

    writeJson(STATE_FILE, this.getState());
  }

  async start() {
    if (this.running) return { ok: true, status: "ALREADY_RUNNING", state: this.getState() };

    this.running = true;
    this.state.status = "RUNNING";
    this.state.startedAt = now();
    this.state.stoppedAt = null;

    await this.runCycle();

    this.timer = setInterval(() => {
      this.runCycle().catch((err) => {
        this.state.ok = false;
        this.state.lastError = err.message;
        writeJson(STATE_FILE, this.getState());
      });
    }, this.pollIntervalMs);

    return { ok: true, status: "STARTED", state: this.getState() };
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.running = false;
    this.state.status = "STOPPED";
    this.state.stoppedAt = now();
    writeJson(STATE_FILE, this.getState());
    return { ok: true, status: "STOPPED", state: this.getState() };
  }

  async runCycle() {
    this.state.cycleCount += 1;
    this.state.lastCycleAt = now();

    const queue = readJson(QUEUE_FILE, { operations: [] });
    queue.operations = Array.isArray(queue.operations) ? queue.operations : [];

    const op = queue.operations
      .filter((x) => x.status === "READY")
      .sort((a, b) => Number(a.priority || 99) - Number(b.priority || 99))[0];

    if (!op) {
      writeJson(STATE_FILE, this.getState());
      return { ok: true, status: "NO_READY_OPERATIONS", state: this.getState() };
    }

    op.status = "COMPLETED";
    op.result = {
      ok: true,
      status: "EXECUTIVE_LOOP_ACKNOWLEDGED",
      message: "Miles claimed this operation. Worker execution integration is next.",
      worker: op.worker || null,
      completedAt: now()
    };
    op.updatedAt = now();
    op.completedAt = now();

    this.state.operationsClaimed += 1;
    this.state.operationsCompleted += 1;
    this.state.lastOperationId = op.id;
    this.state.status = "RUNNING";
    this.state.lastError = null;

    queue.generatedAt = now();
    writeJson(QUEUE_FILE, queue);

    log({
      service: this.service,
      status: "OPERATION_COMPLETED",
      operationId: op.id,
      worker: op.worker,
      title: op.title
    });

    writeJson(STATE_FILE, this.getState());

    return { ok: true, status: "OPERATION_COMPLETED", operation: op, state: this.getState() };
  }

  getState() {
    return { ...this.state, running: this.running, generatedAt: now() };
  }
}

module.exports = COOExecutiveLoopService;
module.exports.COOExecutiveLoopService = COOExecutiveLoopService;
module.exports.default = COOExecutiveLoopService;

if (require.main === module) {
  const service = new COOExecutiveLoopService();

  service.start().then((result) => {
    console.log(JSON.stringify(result, null, 2));
    console.log("COO Executive Loop running. Press Ctrl+C to stop.");
  });

  process.on("SIGINT", async () => {
    await service.stop();
    process.exit(0);
  });
}