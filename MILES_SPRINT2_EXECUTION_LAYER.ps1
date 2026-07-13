param(
    [string]$RepoRoot = "D:\P2GC_Intelligence\MILES_OS"
)

$ErrorActionPreference = "Stop"

function Write-FileSafe {
    param(
        [string]$Path,
        [string]$Content
    )
    $dir = Split-Path $Path -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    if (Test-Path $Path) {
        $backup = "$Path.bak_$(Get-Date -Format 'yyyyMMdd_HHmmss')"
        Copy-Item $Path $backup -Force
        Write-Host "Backed up: $backup"
    }
    Set-Content -Path $Path -Value $Content -Encoding UTF8
    Write-Host "Wrote: $Path"
}

if (-not (Test-Path $RepoRoot)) {
    throw "RepoRoot not found: $RepoRoot"
}

Set-Location $RepoRoot

$executionService = @'
const path = require("path");

function safeRequire(candidates) {
  for (const candidate of candidates) {
    try { return require(candidate); } catch (_) {}
  }
  throw new Error(`Unable to require any of: ${candidates.join(", ")}`);
}

const database = safeRequire(["../CORE/Database", "../CORE/database"]);
const connectorManager = safeRequire(["../CORE/ConnectorManager", "../CORE/connectorManager"]);
const eventBus = safeRequire(["../CORE/EventBus", "../CORE/eventBus"]);
const authority = safeRequire(["../CORE/authority", "../CORE/Authority"]);

let logger;
try {
  logger = safeRequire(["../CORE/Logger", "../CORE/logger"]);
} catch (_) {
  logger = { info: console.log, error: console.error, warn: console.warn };
}

function now() {
  return new Date().toISOString();
}

function json(value) {
  return JSON.stringify(value || {});
}

function parseJson(value, fallback = {}) {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch (_) { return fallback; }
}

class ExecutionService {
  constructor() {
    this.db = database.get();
    this.ensureSchema();
  }

  ensureSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS task_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task TEXT,
        type TEXT,
        connector TEXT,
        action TEXT,
        payload_json TEXT,
        status TEXT DEFAULT 'QUEUED',
        priority INTEGER DEFAULT 5,
        approval_status TEXT DEFAULT 'NOT_REQUIRED',
        attempts INTEGER DEFAULT 0,
        result_json TEXT,
        error TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        completed_at DATETIME
      );

      CREATE TABLE IF NOT EXISTS execution_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        level TEXT,
        message TEXT,
        task_id INTEGER,
        connector TEXT,
        action TEXT,
        status TEXT,
        details_json TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS approvals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER,
        status TEXT DEFAULT 'PENDING',
        requested_reason TEXT,
        decided_by TEXT,
        decided_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    this.addColumnIfMissing("task_queue", "type", "TEXT");
    this.addColumnIfMissing("task_queue", "connector", "TEXT");
    this.addColumnIfMissing("task_queue", "action", "TEXT");
    this.addColumnIfMissing("task_queue", "payload_json", "TEXT");
    this.addColumnIfMissing("task_queue", "approval_status", "TEXT DEFAULT 'NOT_REQUIRED'");
    this.addColumnIfMissing("task_queue", "attempts", "INTEGER DEFAULT 0");
    this.addColumnIfMissing("task_queue", "result_json", "TEXT");
    this.addColumnIfMissing("task_queue", "error", "TEXT");
    this.addColumnIfMissing("task_queue", "updated_at", "DATETIME DEFAULT CURRENT_TIMESTAMP");
    this.addColumnIfMissing("task_queue", "completed_at", "DATETIME");
  }

  addColumnIfMissing(table, column, definition) {
    const rows = this.db.prepare(`PRAGMA table_info(${table})`).all();
    if (!rows.some(r => r.name === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

  log(level, message, details = {}) {
    this.db.prepare(`
      INSERT INTO execution_log (level, message, task_id, connector, action, status, details_json)
      VALUES (@level, @message, @task_id, @connector, @action, @status, @details_json)
    `).run({
      level,
      message,
      task_id: details.task_id || null,
      connector: details.connector || null,
      action: details.action || null,
      status: details.status || null,
      details_json: json(details)
    });

    if (logger[level.toLowerCase()]) logger[level.toLowerCase()](message, details);
    else logger.info(message, details);
  }

  classify(task) {
    const system = task.connector || task.system || task.type || "MILES";
    const action = task.action || task.task || task.type || "execute";
    const result = authority.requiresApproval(system, action);

    if (result.allowed === false && /never allowed|prohibited/i.test(result.approval || "")) {
      return { decision: "PROHIBITED", reason: result.approval };
    }

    if (result.allowed === false || /approval required/i.test(result.approval || "")) {
      return { decision: "CEO_APPROVAL", reason: result.approval };
    }

    return { decision: "AUTO_EXECUTE", reason: result.approval || "No approval required" };
  }

  enqueue(task) {
    const connector = String(task.connector || task.system || "MILES").toUpperCase();
    const action = task.action || task.type || task.task || "execute";
    const type = task.type || `${connector}.${action}`;
    const payload = task.payload || {};
    const priority = Number(task.priority || 5);
    const taskText = task.task || `${connector} ${action}`;
    const classification = this.classify({ connector, action, task: taskText });

    const status = classification.decision === "PROHIBITED"
      ? "PROHIBITED"
      : classification.decision === "CEO_APPROVAL"
        ? "APPROVAL_REQUIRED"
        : "QUEUED";

    const approvalStatus = classification.decision === "CEO_APPROVAL" ? "PENDING" : classification.decision;

    const info = this.db.prepare(`
      INSERT INTO task_queue (task, type, connector, action, payload_json, status, priority, approval_status, updated_at)
      VALUES (@task, @type, @connector, @action, @payload_json, @status, @priority, @approval_status, CURRENT_TIMESTAMP)
    `).run({
      task: taskText,
      type,
      connector,
      action,
      payload_json: json(payload),
      status,
      priority,
      approval_status: approvalStatus
    });

    const taskId = info.lastInsertRowid;

    if (status === "APPROVAL_REQUIRED") {
      this.db.prepare(`INSERT INTO approvals (task_id, requested_reason) VALUES (?, ?)`)
        .run(taskId, classification.reason);
    }

    const created = this.getTask(taskId);
    eventBus.publish("TASK_CREATED", created);
    this.log("INFO", "Task enqueued", { task_id: taskId, connector, action, status, approval: classification.reason });
    return created;
  }

  getTask(id) {
    return this.db.prepare(`SELECT * FROM task_queue WHERE id = ?`).get(id);
  }

  listTasks(limit = 50) {
    return this.db.prepare(`SELECT * FROM task_queue ORDER BY id DESC LIMIT ?`).all(limit);
  }

  nextQueuedTask() {
    return this.db.prepare(`
      SELECT * FROM task_queue
      WHERE status = 'QUEUED'
      ORDER BY priority DESC, id ASC
      LIMIT 1
    `).get();
  }

  approve(taskId, decidedBy = "Kevin") {
    const task = this.getTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    this.db.prepare(`UPDATE approvals SET status = 'APPROVED', decided_by = ?, decided_at = CURRENT_TIMESTAMP WHERE task_id = ?`)
      .run(decidedBy, taskId);

    this.db.prepare(`UPDATE task_queue SET status = 'QUEUED', approval_status = 'APPROVED', updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(taskId);

    const updated = this.getTask(taskId);
    eventBus.publish("TASK_APPROVED", updated);
    this.log("INFO", "Task approved", { task_id: taskId });
    return updated;
  }

  reject(taskId, decidedBy = "Kevin") {
    const task = this.getTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    this.db.prepare(`UPDATE approvals SET status = 'REJECTED', decided_by = ?, decided_at = CURRENT_TIMESTAMP WHERE task_id = ?`)
      .run(decidedBy, taskId);

    this.db.prepare(`UPDATE task_queue SET status = 'REJECTED', approval_status = 'REJECTED', updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(taskId);

    const updated = this.getTask(taskId);
    eventBus.publish("TASK_REJECTED", updated);
    this.log("INFO", "Task rejected", { task_id: taskId });
    return updated;
  }

  async executeTask(task) {
    const connectorName = String(task.connector || "").toUpperCase();
    const connector = connectorManager.get(connectorName);

    if (!connector) {
      throw new Error(`Connector not registered: ${connectorName}`);
    }

    if (typeof connector.execute !== "function") {
      throw new Error(`Connector ${connectorName} does not expose execute(task)`);
    }

    const executionPayload = {
      id: task.id,
      type: task.type,
      action: task.action,
      connector: connectorName,
      payload: parseJson(task.payload_json),
      raw: task
    };

    const result = await connector.execute(executionPayload);

    if (typeof connector.verify === "function") {
      const verification = await connector.verify(result, executionPayload);
      return { result, verification };
    }

    return { result, verification: { ok: true, message: "No connector verifier defined" } };
  }

  async executeNext() {
    const task = this.nextQueuedTask();
    if (!task) return { executed: false, message: "No queued tasks" };

    const classification = this.classify(task);
    if (classification.decision === "PROHIBITED") {
      this.db.prepare(`UPDATE task_queue SET status = 'PROHIBITED', error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .run(classification.reason, task.id);
      this.log("WARN", "Task prohibited", { task_id: task.id, connector: task.connector, action: task.action, status: "PROHIBITED", reason: classification.reason });
      return { executed: false, taskId: task.id, status: "PROHIBITED", reason: classification.reason };
    }

    if (classification.decision === "CEO_APPROVAL" && task.approval_status !== "APPROVED") {
      this.db.prepare(`UPDATE task_queue SET status = 'APPROVAL_REQUIRED', approval_status = 'PENDING', updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .run(task.id);
      this.db.prepare(`INSERT INTO approvals (task_id, requested_reason) SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM approvals WHERE task_id = ?)`)
        .run(task.id, classification.reason, task.id);
      this.log("INFO", "Task requires approval", { task_id: task.id, connector: task.connector, action: task.action, status: "APPROVAL_REQUIRED", reason: classification.reason });
      return { executed: false, taskId: task.id, status: "APPROVAL_REQUIRED", reason: classification.reason };
    }

    this.db.prepare(`UPDATE task_queue SET status = 'RUNNING', attempts = COALESCE(attempts, 0) + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(task.id);

    eventBus.publish("TASK_STARTED", task);
    this.log("INFO", "Task started", { task_id: task.id, connector: task.connector, action: task.action, status: "RUNNING" });

    try {
      const outcome = await this.executeTask(task);
      this.db.prepare(`
        UPDATE task_queue
        SET status = 'COMPLETED', result_json = ?, error = NULL, completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(json(outcome), task.id);

      const completed = this.getTask(task.id);
      eventBus.publish("TASK_COMPLETED", completed);
      this.log("INFO", "Task completed", { task_id: task.id, connector: task.connector, action: task.action, status: "COMPLETED" });
      return { executed: true, taskId: task.id, status: "COMPLETED", outcome };
    } catch (error) {
      this.db.prepare(`
        UPDATE task_queue
        SET status = 'FAILED', error = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(error.stack || error.message, task.id);

      const failed = this.getTask(task.id);
      eventBus.publish("TASK_FAILED", failed);
      this.log("ERROR", "Task failed", { task_id: task.id, connector: task.connector, action: task.action, status: "FAILED", error: error.message });
      return { executed: false, taskId: task.id, status: "FAILED", error: error.message };
    }
  }
}

module.exports = new ExecutionService();
'@

$schedulerService = @'
const executionService = require("./ExecutionService");

class SchedulerService {
  constructor() {
    this.timer = null;
    this.running = false;
    this.intervalMs = Number(process.env.MILES_SCHEDULER_INTERVAL_MS || 5000);
  }

  async tick() {
    if (this.running) return { skipped: true, reason: "Previous tick still running" };
    this.running = true;
    try {
      return await executionService.executeNext();
    } finally {
      this.running = false;
    }
  }

  start(intervalMs = this.intervalMs) {
    if (this.timer) return { started: false, message: "Scheduler already running" };
    this.intervalMs = intervalMs;
    this.timer = setInterval(() => {
      this.tick().catch(error => console.error("MILES scheduler tick failed:", error.stack || error.message));
    }, this.intervalMs);
    return { started: true, intervalMs: this.intervalMs };
  }

  stop() {
    if (!this.timer) return { stopped: false, message: "Scheduler is not running" };
    clearInterval(this.timer);
    this.timer = null;
    return { stopped: true };
  }

  status() {
    return { running: Boolean(this.timer), busy: this.running, intervalMs: this.intervalMs };
  }
}

module.exports = new SchedulerService();
'@

$taskRoutes = @'
const express = require("express");
const router = express.Router();
const executionService = require("../SERVICES/ExecutionService");
const schedulerService = require("../SERVICES/SchedulerService");

router.get("/", (req, res) => {
  const limit = Number(req.query.limit || 50);
  res.json({ success: true, tasks: executionService.listTasks(limit) });
});

router.post("/", (req, res) => {
  try {
    const task = executionService.enqueue(req.body || {});
    res.json({ success: true, task });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.post("/run-next", async (req, res) => {
  try {
    const result = await executionService.executeNext();
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post("/:id/approve", (req, res) => {
  try {
    const task = executionService.approve(Number(req.params.id), req.body?.decidedBy || "Kevin");
    res.json({ success: true, task });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.post("/:id/reject", (req, res) => {
  try {
    const task = executionService.reject(Number(req.params.id), req.body?.decidedBy || "Kevin");
    res.json({ success: true, task });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.get("/scheduler", (req, res) => {
  res.json({ success: true, scheduler: schedulerService.status() });
});

router.post("/scheduler/start", (req, res) => {
  const intervalMs = req.body?.intervalMs ? Number(req.body.intervalMs) : undefined;
  res.json({ success: true, result: schedulerService.start(intervalMs) });
});

router.post("/scheduler/stop", (req, res) => {
  res.json({ success: true, result: schedulerService.stop() });
});

module.exports = router;
'@

$statusRoutes = @'
const express = require("express");
const router = express.Router();

function safeRequire(candidates) {
  for (const candidate of candidates) {
    try { return require(candidate); } catch (_) {}
  }
  return null;
}

const database = safeRequire(["../CORE/Database", "../CORE/database"]);
const connectorManager = safeRequire(["../CORE/ConnectorManager", "../CORE/connectorManager"]);
const schedulerService = safeRequire(["../SERVICES/SchedulerService"]);

router.get("/", async (req, res) => {
  const db = database?.get?.();
  const counts = db ? {
    queued: db.prepare("SELECT COUNT(*) AS count FROM task_queue WHERE status = 'QUEUED'").get().count,
    running: db.prepare("SELECT COUNT(*) AS count FROM task_queue WHERE status = 'RUNNING'").get().count,
    approvalRequired: db.prepare("SELECT COUNT(*) AS count FROM task_queue WHERE status = 'APPROVAL_REQUIRED'").get().count,
    failed: db.prepare("SELECT COUNT(*) AS count FROM task_queue WHERE status = 'FAILED'").get().count,
    completed: db.prepare("SELECT COUNT(*) AS count FROM task_queue WHERE status = 'COMPLETED'").get().count
  } : null;

  const connectors = connectorManager?.healthCheckAll ? await connectorManager.healthCheckAll() : [];

  res.json({
    success: true,
    system: "MILES OS",
    generatedAt: new Date().toISOString(),
    taskCounts: counts,
    scheduler: schedulerService?.status?.() || null,
    connectors
  });
});

module.exports = router;
'@

$server = @'
require("dotenv").config();
const express = require("express");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(express.json({ limit: "2mb" }));

function mount(route, modulePath) {
  try {
    app.use(route, require(modulePath));
    console.log(`Mounted ${route} -> ${modulePath}`);
  } catch (error) {
    console.log(`Skipped ${route}: ${error.message}`);
  }
}

app.get("/", (req, res) => {
  res.json({
    success: true,
    system: "MILES OS",
    status: "running",
    version: "1.1-execution-layer",
    generatedAt: new Date().toISOString()
  });
});

mount("/api/memory", "./API/memory.routes");
mount("/api/tasks", "./API/tasks.routes");
mount("/api/status", "./API/status.routes");

app.listen(PORT, () => {
  console.log(`MILES API listening on port ${PORT}`);
});
'@

$runOnce = @'
param(
  [string]$RepoRoot = "D:\P2GC_Intelligence\MILES_OS"
)
Set-Location $RepoRoot
node -e "require('./SERVICES/ExecutionService').executeNext().then(r=>console.log(JSON.stringify(r,null,2))).catch(e=>{console.error(e.stack||e.message);process.exit(1);})"
'@

$startApi = @'
param(
  [string]$RepoRoot = "D:\P2GC_Intelligence\MILES_OS"
)
Set-Location $RepoRoot
node server.js
'@

$testTask = @'
param(
  [string]$RepoRoot = "D:\P2GC_Intelligence\MILES_OS"
)
Set-Location $RepoRoot
node -e "const e=require('./SERVICES/ExecutionService'); const t=e.enqueue({connector:'GOOGLE', action:'healthCheck', task:'Check Google connector health', priority:10}); console.log(JSON.stringify(t,null,2));"
'@

Write-FileSafe -Path (Join-Path $RepoRoot "SERVICES\ExecutionService.js") -Content $executionService
Write-FileSafe -Path (Join-Path $RepoRoot "SERVICES\SchedulerService.js") -Content $schedulerService
Write-FileSafe -Path (Join-Path $RepoRoot "API\tasks.routes.js") -Content $taskRoutes
Write-FileSafe -Path (Join-Path $RepoRoot "API\status.routes.js") -Content $statusRoutes
Write-FileSafe -Path (Join-Path $RepoRoot "server.js") -Content $server
Write-FileSafe -Path (Join-Path $RepoRoot "scripts\RUN_EXECUTION_ONCE.ps1") -Content $runOnce
Write-FileSafe -Path (Join-Path $RepoRoot "scripts\START_MILES_API.ps1") -Content $startApi
Write-FileSafe -Path (Join-Path $RepoRoot "scripts\QUEUE_TEST_GOOGLE_HEALTH_TASK.ps1") -Content $testTask

Write-Host ""
Write-Host "MILES Sprint 2 Execution Layer installed."
Write-Host "Next commands:"
Write-Host "  git status"
Write-Host "  .\scripts\START_MILES_API.ps1"
Write-Host "  .\scripts\QUEUE_TEST_GOOGLE_HEALTH_TASK.ps1"
Write-Host "  .\scripts\RUN_EXECUTION_ONCE.ps1"
