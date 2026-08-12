"use strict";

const RevenueMissionSourceService = require("./RevenueMissionSourceService");

const fs = require("fs");
const path = require("path");
const ProviderRegistry = require("./ProviderRegistry");

let taskQueue = null;

try {
  taskQueue = require("../CORE/TaskQueue");
} catch {
  taskQueue = null;
}

const ROOT = process.env.MILES_ROOT || path.resolve(__dirname, "..");

function now() {
  return new Date().toISOString();
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

class BusinessOperationsBridgeService {
  constructor(options = {}) {
    this.name = "BusinessOperationsBridgeService";
    this.taskQueue = options.taskQueue || taskQueue;
    this.enabled = options.enabled !== false;
    this.rootDir = options.rootDir || ROOT;
    this.queueFile =
      options.queueFile ||
      path.join(this.rootDir, "state", "business_operations_queue.json");

    this.marketingQueueFile =
      options.marketingQueueFile ||
      path.join(
        this.rootDir,
        "DATA",
        "digital_coo",
        "registries",
        "marketing_work_queue.json"
      );

    this.lastRun = null;
    this.bridgedCount = 0;
    this.failedCount = 0;

    this.revenueMissionSource =
      options.revenueMissionSource ||
      new RevenueMissionSourceService({
        rootDir: this.rootDir
      });
  }

  log(message) {
    console.log(`[BUSINESS-BRIDGE] ${message}`);
  }

  readQueue() {
    return readJson(this.queueFile, {
      generatedAt: now(),
      source: "MILES_COMMAND_CENTER",
      operations: []
    });
  }

  writeQueue(queue) {
    queue.generatedAt = now();
    writeJson(this.queueFile, queue);
  }

  readMarketingQueue() {
    const queue = readJson(this.marketingQueueFile, []);

    if (Array.isArray(queue)) return queue;
    if (queue && Array.isArray(queue.operations)) return queue.operations;
    if (queue && Array.isArray(queue.items)) return queue.items;
    if (queue && Array.isArray(queue.workItems)) return queue.workItems;
    return [];
  }

  buildMarketingOperation(item = {}, index = 0) {
    const title = item.title || item.command || item.objective || "Marketing business operation";
    const reason = item.reason || item.description || item.objective || title;
    const sourceKey = [item.id || "", item.department || "Marketing", title, reason].join("|");
    const generatedId = "MARKETING_" + Buffer.from(sourceKey, "utf8").toString("base64url").slice(0, 64);
    const requiresKevin = item.requiresKevin === true;
    let status = String(item.status || (requiresKevin ? "AWAITING_APPROVAL" : "READY")).toUpperCase();
    if (requiresKevin && ["READY", "PENDING", "NEW"].includes(status)) status = "AWAITING_APPROVAL";
    const action = item.action || item.type || (/paused.*campaign|campaign.*paused/i.test(`${title} ${reason}`) ? "REVIEW_PAUSED_CAMPAIGNS" : "MARKETING_OPERATION");
    const provider = item.provider || item.connector || (/instantly|campaign|email|lead|outbound/i.test(`${title} ${reason}`) ? "INSTANTLY" : "Marketing");

    return {
      ...item,
      id: item.id || generatedId,
      source: "marketing_work_queue",
      sourceQueue: this.marketingQueueFile,
      sourceIndex: index,
      department: item.department || "Marketing",
      provider,
      connector: item.connector || provider,
      system: item.system || provider,
      action,
      capability: item.capability || action,
      type: item.type || action,
      title,
      command: item.command || title,
      objective: item.objective || reason,
      reason,
      requiresKevin,
      status,
      importedAt: item.importedAt || now(),
      updatedAt: now()
    };
  }

  importMarketingWork() {
    const marketingItems = this.readMarketingQueue();
    if (!marketingItems.length) return { found: 0, imported: 0, updated: 0 };

    const businessQueue = this.readQueue();
    businessQueue.operations = Array.isArray(businessQueue.operations) ? businessQueue.operations : [];
    const existingById = new Map(businessQueue.operations.filter(o => o && o.id).map(o => [o.id, o]));
    let imported = 0;
    let updated = 0;

    marketingItems.forEach((item, index) => {
      const incoming = this.buildMarketingOperation(item, index);
      const existing = existingById.get(incoming.id);
      if (!existing) {
        businessQueue.operations.push(incoming);
        existingById.set(incoming.id, incoming);
        imported++;
        return;
      }
      const terminalStates = ["BRIDGED", "COMPLETED", "EXECUTED", "CANCELLED", "REJECTED"];
      const existingStatus = String(existing.status || "").toUpperCase();
      if (terminalStates.includes(existingStatus)) return;
      Object.assign(existing, { ...incoming, importedAt: existing.importedAt || incoming.importedAt, updatedAt: now() });
      updated++;
    });

    this.writeQueue(businessQueue);
    this.log(`Marketing import found=${marketingItems.length} imported=${imported} updated=${updated}`);
    return { found: marketingItems.length, imported, updated };
  }

  importRevenueWork() {
    if (!this.revenueMissionSource || typeof this.revenueMissionSource.readCandidates !== "function") {
      return { found: 0, imported: 0, updated: 0, sources: [] };
    }

    const revenueRead = this.revenueMissionSource.readCandidates();
    const candidates = Array.isArray(revenueRead.candidates) ? revenueRead.candidates : [];
    if (!candidates.length) {
      return { found: 0, imported: 0, updated: 0, sources: revenueRead.sourceSummary || [] };
    }

    const businessQueue = this.readQueue();
    businessQueue.operations = Array.isArray(businessQueue.operations) ? businessQueue.operations : [];
    const existingById = new Map(businessQueue.operations.filter(o => o && o.id).map(o => [o.id, o]));
    const terminalStates = ["BRIDGED", "COMPLETED", "EXECUTED", "CANCELLED", "REJECTED"];
    let imported = 0;
    let updated = 0;

    for (const incoming of candidates) {
      const existing = existingById.get(incoming.id);
      if (!existing) {
        businessQueue.operations.push(incoming);
        existingById.set(incoming.id, incoming);
        imported++;
        continue;
      }
      const existingStatus = String(existing.status || "").toUpperCase();
      if (terminalStates.includes(existingStatus)) continue;
      Object.assign(existing, { ...incoming, importedAt: existing.importedAt || incoming.importedAt, updatedAt: now() });
      updated++;
    }

    this.writeQueue(businessQueue);
    this.log(`Revenue import found=${candidates.length} imported=${imported} updated=${updated}`);
    return { found: candidates.length, imported, updated, sources: revenueRead.sourceSummary || [] };
  }

  isPending(operation) {
    return ["READY", "PENDING", "NEW"].includes(String(operation.status || "").toUpperCase());
  }

  resolveProvider(operation = {}) {
    const provider = ProviderRegistry.resolve(operation);
    return provider ? provider.id : "MILES";
  }

  normalizePriority(value) {
    if (value === 1 || value === "1") return 1;
    if (value === 2 || value === "2") return 2;
    if (value === 3 || value === "3") return 3;
    if (value === 4 || value === "4") return 4;
    const text = String(value || "").toUpperCase();
    if (text === "CRITICAL") return 1;
    if (text === "HIGH") return 2;
    if (text === "MEDIUM" || text === "NORMAL") return 3;
    if (text === "LOW") return 4;
    return 3;
  }

  buildTaskParts(operation = {}) {
    const planned = operation.plan || {};
    const command = operation.command || planned.originalCommand || planned.objective || operation.title || operation.objective || "Business operation";
    const action = operation.action || planned.action || operation.type || "BUSINESS_OPERATION";
    const capability = operation.capability || planned.capability || action;
    const workflow = operation.workflow || planned.workflow || null;
    const intent = operation.intent || planned.intent || null;
    const provider = operation.provider || planned.provider || this.resolveProvider(operation);
    const connector = operation.connector || planned.connector || provider;
    const system = operation.system || planned.system || provider;
    const department = operation.department || planned.department || provider;

    const payload = {
      ...operation,
      provider,
      system,
      department,
      connector,
      action,
      capability,
      workflow,
      intent,
      objective: operation.objective || planned.objective || command,
      command,
      sourceOperationId: operation.id,
      source: operation.source || "business_operations_queue",
      plan: {
        ...planned,
        provider,
        system,
        department,
        connector,
        action,
        capability,
        workflow,
        intent,
        objective: planned.objective || operation.objective || command,
        originalCommand: planned.originalCommand || command
      }
    };

    return {
      type: "WORKFORCE_STEP",
      payload,
      priority: this.normalizePriority(operation.priority)
    };
  }

  enqueueTask(operation) {
    if (!this.taskQueue) throw new Error("TaskQueue unavailable");
    const task = this.buildTaskParts(operation);
    this.log(`Routing trace operation=${operation.id || "UNKNOWN"} type=${task.type} action=${task.payload.action} capability=${task.payload.capability} workflow=${task.payload.workflow} connector=${task.payload.connector}`);
    if (typeof this.taskQueue.add !== "function") throw new Error("TaskQueue.add(type, payload, priority) unavailable");
    return this.taskQueue.add(task.type, task.payload, task.priority);
  }

  markOperation(operationId, patch) {
    const queue = this.readQueue();
    queue.operations = Array.isArray(queue.operations) ? queue.operations : [];
    queue.operations = queue.operations.map(operation => operation.id !== operationId ? operation : { ...operation, ...patch, updatedAt: now() });
    this.writeQueue(queue);
  }

  async runOnce() {
    if (!this.enabled) {
      return { ok: true, status: "DISABLED", operationsFound: 0, operationsQueued: 0, operationsFailed: 0 };
    }

    this.lastRun = now();
    const marketingImport = this.importMarketingWork();
    const revenueImport = this.importRevenueWork();
    const queue = this.readQueue();
    queue.operations = Array.isArray(queue.operations) ? queue.operations : [];
    const pending = queue.operations.filter(operation => this.isPending(operation));

    if (!pending.length) {
      this.log("No pending business operations.");
      return {
        ok: true,
        status: "NO_PENDING_OPERATIONS",
        queueFile: this.queueFile,
        marketingQueueFile: this.marketingQueueFile,
        marketingImport,
        revenueImport,
        operationsFound: 0,
        operationsQueued: 0,
        operationsFailed: 0
      };
    }

    this.log(`Found ${pending.length} pending business operation(s).`);
    let queued = 0;
    let failed = 0;

    for (const operation of pending) {
      try {
        const task = this.enqueueTask(operation);
        this.markOperation(operation.id, { status: "BRIDGED", bridgedAt: now(), taskQueueStatus: "QUEUED", taskId: task.id || null });
        queued++;
        this.bridgedCount++;
        this.log(`Bridged operation to TaskQueue: ${operation.title || operation.command}`);
      } catch (error) {
        this.markOperation(operation.id, { status: "BRIDGE_FAILED", bridgeFailedAt: now(), taskQueueStatus: "FAILED", error: error.message });
        failed++;
        this.failedCount++;
        this.log(`Bridge failed: ${error.message}`);
      }
    }

    return {
      ok: failed === 0,
      status: failed === 0 ? "BRIDGE_COMPLETED" : "BRIDGE_COMPLETED_WITH_FAILURES",
      queueFile: this.queueFile,
      marketingQueueFile: this.marketingQueueFile,
      marketingImport,
      revenueImport,
      operationsFound: pending.length,
      operationsQueued: queued,
      operationsFailed: failed,
      bridged: queued,
      failed
    };
  }

  getStatus() {
    return {
      service: this.name,
      enabled: this.enabled,
      lastRun: this.lastRun,
      bridgedCount: this.bridgedCount,
      failedCount: this.failedCount,
      queueFile: this.queueFile,
      marketingQueueFile: this.marketingQueueFile
    };
  }
}

module.exports = new BusinessOperationsBridgeService();
module.exports.BusinessOperationsBridgeService = BusinessOperationsBridgeService;
