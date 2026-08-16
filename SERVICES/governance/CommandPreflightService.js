"use strict";

const fs = require("fs");
const path = require("path");
const ExecutionActionCapabilityService = require("./ExecutionActionCapabilityService");

class CommandPreflightService {
  constructor(options = {}) {
    this.rootDir = options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, "..", "..");
    this.providerAuthority = options.providerAuthority || require("../ProviderAuthorityRegistryService");
    this.actionCapability = options.actionCapability || new ExecutionActionCapabilityService({ rootDir: this.rootDir });
    this.queueMaxBytes = Math.max(1024 * 1024, Number(options.queueMaxBytes || process.env.MILES_CEO_QUEUE_MAX_BYTES || 64 * 1024 * 1024));
    this.workerMaxAgeMs = Math.max(5000, Number(options.workerMaxAgeMs || process.env.MILES_CEO_WORKER_STATUS_MAX_AGE_MS || 120000));
    this.now = typeof options.now === "function" ? options.now : () => Date.now();
    this.graphPath = path.join(this.rootDir, "CONFIG", "PRODUCTION_SYSTEM_GRAPH.json");
    this.workerStatusPath = path.join(this.rootDir, "DATA", "runtime", "worker_runtime_status.json");
    this.queuePath = path.join(this.rootDir, "DATA", "runtime", "task_queue.json");
    this.lockPath = path.join(this.rootDir, "DATA", "runtime", "task_queue.lock");
  }

  readJson(file, fallback = null) {
    try {
      if (!fs.existsSync(file)) return fallback;
      return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
    } catch {
      return fallback;
    }
  }

  fileBytes(file) {
    try {
      return fs.statSync(file).size;
    } catch {
      return 0;
    }
  }

  isCEOOperation(operation = {}) {
    const source = String(operation.source || operation.payload?.source || "").toUpperCase();
    const sourceOperationId = operation.sourceOperationId || operation.payload?.sourceOperationId;
    return source === "MILES_COMMAND_CENTER" || Boolean(sourceOperationId && String(sourceOperationId).startsWith("op_"));
  }

  approvalSatisfied(operation = {}) {
    const decision = String(operation.approvalDecision || "").toUpperCase();
    const actor = String(operation.approvedBy || "").toUpperCase();
    return decision === "APPROVED" && actor === "CEO" && Boolean(operation.approvedAt);
  }

  normalizeProvider(value) {
    const raw = String(value || "MILES").trim().toLowerCase();
    const aliases = {
      miles: "miles",
      executive: "miles",
      revenue: "miles",
      marketing: "miles",
      sales: "miles",
      workforce: "miles",
      instantly: "instantly",
      google: "google_workspace",
      gmail: "google_workspace",
      calendar: "google_workspace",
      drive: "google_workspace",
      google_workspace: "google_workspace",
      namecheap: "namecheap",
      website: "website",
      orion: "orion",
      filesystem: "filesystem",
      file_system: "filesystem"
    };
    return aliases[raw] || raw;
  }

  requiredProviders(operation = {}, task = {}) {
    const plan = operation.plan || task.payload?.plan || {};
    const values = [
      operation.provider,
      operation.connector,
      plan.provider,
      plan.connector,
      task.payload?.provider,
      task.payload?.connector
    ];

    if (Array.isArray(plan.steps)) {
      for (const step of plan.steps) values.push(step?.provider, step?.connector);
    }

    const providers = new Set();
    for (const value of values) {
      if (!value) continue;
      providers.add(this.normalizeProvider(value));
    }
    if (!providers.size) providers.add("miles");
    return [...providers];
  }

  commandText(operation = {}, task = {}) {
    return String(
      operation.command ||
      operation.objective ||
      task.payload?.command ||
      task.payload?.objective ||
      ""
    ).toLowerCase().replace(/\s+/g, " ").trim();
  }

  actionText(operation = {}, task = {}) {
    return String(
      operation.action ||
      operation.capability ||
      task.type ||
      task.payload?.action ||
      task.payload?.capability ||
      ""
    ).toUpperCase();
  }

  hasNegatedExternalWrites(text) {
    return /\b(do not|don't|dont|never|without)\b.{0,100}\b(send|submit|publish|modify|change|activate|pause|resume|upload|assign|delete|charge|purchase|sign|launch|create)\b/i.test(text);
  }

  requestsWrite(operation = {}, task = {}) {
    if (operation.approvalRequired === true || operation.requiresKevin === true) return true;

    const text = this.commandText(operation, task);
    if (this.hasNegatedExternalWrites(text)) return false;
    if (/\bread[- ]?only\b|\breview only\b|\breport only\b|\banaly[sz]e only\b/i.test(text)) return false;

    const action = this.actionText(operation, task);
    if (/^(CREATE|UPDATE|DELETE|SEND|SUBMIT|LAUNCH|ACTIVATE|PAUSE|RESUME|UPLOAD|ASSIGN|PUBLISH|CHARGE|MODIFY|WRITE|PROVISION|PURCHASE|SIGN|EXECUTE_EXTERNAL|CONTROLLED_WRITE)/.test(action)) return true;

    return /\b(send|submit|publish|modify|change|activate|pause|resume|upload|assign|delete|charge|purchase|sign|launch|create)\b/i.test(text) &&
      /\b(email|message|campaign|lead|website|linkedin|payment|contract|proposal|mailbox|domain|dns|account)\b/i.test(text);
  }

  sourceIntegrityCheck() {
    const graph = this.readJson(this.graphPath, null);
    if (!graph) return { ok: false, code: "PRODUCTION_GRAPH_MISSING", detail: this.graphPath };

    const required = Array.isArray(graph.criticalModules) ? graph.criticalModules : [];
    const missing = required.filter(file => !fs.existsSync(path.join(this.rootDir, file)));
    if (missing.length) return { ok: false, code: "SOURCE_CLOSURE_INCOMPLETE", detail: missing };

    return { ok: true, code: "SOURCE_CLOSURE_READY", detail: { criticalModules: required.length } };
  }

  actionCapabilityCheck(operation = {}, task = {}) {
    try {
      return this.actionCapability.evaluate({ operation, task });
    } catch (error) {
      return {
        ok: false,
        code: "ACTION_CAPABILITY_PREFLIGHT_FAILED",
        detail: error.message
      };
    }
  }

  workerCheck() {
    const status = this.readJson(this.workerStatusPath, null);
    if (!status) return { ok: false, code: "WORKER_STATUS_MISSING", detail: this.workerStatusPath };

    const generated = new Date(status.generatedAt || 0).getTime();
    const ageMs = Number.isFinite(generated) && generated > 0 ? Math.max(0, this.now() - generated) : Number.MAX_SAFE_INTEGER;
    const lifecycle = status.lifecycle || {};
    const running = lifecycle.started === true && lifecycle.shuttingDown !== true;

    if (!running) return { ok: false, code: "WORKER_NOT_READY", detail: { lifecycle, ageMs } };
    if (ageMs > this.workerMaxAgeMs) return { ok: false, code: "WORKER_STATUS_STALE", detail: { ageMs, maxAgeMs: this.workerMaxAgeMs } };

    return {
      ok: true,
      code: "WORKER_READY",
      detail: {
        pid: status.pid || null,
        ageMs,
        rssMb: status.memory?.rssMb ?? null,
        queue: status.queue || null
      }
    };
  }

  queueCheck() {
    const bytes = this.fileBytes(this.queuePath);
    const lockExists = fs.existsSync(this.lockPath);
    const owner = this.readJson(path.join(this.lockPath, "owner.json"), null);

    if (bytes > this.queueMaxBytes) {
      return {
        ok: false,
        code: "QUEUE_MAINTENANCE_REQUIRED",
        detail: { bytes, maxBytes: this.queueMaxBytes, lockExists, owner }
      };
    }

    return {
      ok: true,
      code: "QUEUE_CAPACITY_READY",
      detail: { bytes, maxBytes: this.queueMaxBytes, lockExists, owner }
    };
  }

  providerChecks(operation = {}, task = {}) {
    let authority;
    try {
      authority = this.providerAuthority.run({ source: "CEO_COMMAND_PREFLIGHT" });
    } catch (error) {
      return [{ ok: false, code: "PROVIDER_AUTHORITY_UNAVAILABLE", provider: null, detail: error.message }];
    }

    const writeRequested = this.requestsWrite(operation, task);
    const required = this.requiredProviders(operation, task);
    const internal = new Set(["miles"]);
    const checks = [];

    for (const key of required) {
      if (internal.has(key)) {
        checks.push({ ok: true, code: "INTERNAL_PROVIDER_READY", provider: key, detail: "MILES internal execution" });
        continue;
      }

      const provider = authority.providers?.find(item => item.key === key || item.provider === key);
      if (!provider) {
        checks.push({ ok: false, code: "PROVIDER_NOT_IN_AUTHORITY", provider: key, detail: "No canonical provider authority entry" });
        continue;
      }

      if (!provider.capabilities?.read?.enabled) {
        checks.push({ ok: false, code: "PROVIDER_READ_BLOCKED", provider: key, detail: provider.credentials?.missingEnv || [] });
        continue;
      }

      if (writeRequested && !provider.capabilities?.write?.enabled) {
        checks.push({
          ok: false,
          code: "PROVIDER_WRITE_GOVERNED",
          provider: key,
          detail: {
            status: provider.status,
            writeFlag: provider.capabilities?.write?.flag || null,
            credentialsPresent: provider.credentialsPresent === true
          }
        });
        continue;
      }

      checks.push({
        ok: true,
        code: writeRequested ? "PROVIDER_WRITE_READY" : "PROVIDER_READ_READY",
        provider: key,
        detail: provider.status
      });
    }

    return checks;
  }

  evaluate({ operation = {}, task = {} } = {}) {
    const generatedAt = new Date(this.now()).toISOString();

    if (!this.isCEOOperation(operation)) {
      return {
        ok: true,
        allowedToQueue: true,
        status: "PREFLIGHT_NOT_REQUIRED_FOR_SOURCE",
        generatedAt,
        checks: [],
        blockers: []
      };
    }

    const approvalRequired = operation.approvalRequired === true || operation.requiresKevin === true;
    const approvalSatisfied = this.approvalSatisfied(operation);

    const checks = [
      { area: "SOURCE", ...this.sourceIntegrityCheck() },
      { area: "ACTION", ...this.actionCapabilityCheck(operation, task) },
      { area: "WORKER", ...this.workerCheck() },
      { area: "QUEUE", ...this.queueCheck() },
      ...this.providerChecks(operation, task).map(check => ({ area: "PROVIDER", ...check }))
    ];

    if (approvalRequired && !approvalSatisfied) {
      checks.push({
        area: "GOVERNANCE",
        ok: false,
        code: "CEO_APPROVAL_REQUIRED",
        detail: "Protected action must remain unqueued until explicit CEO approval."
      });
    } else {
      checks.push({
        area: "GOVERNANCE",
        ok: true,
        code: approvalRequired ? "CEO_APPROVAL_VERIFIED" : "GOVERNANCE_READY",
        detail: approvalRequired
          ? { approvedBy: operation.approvedBy, approvedAt: operation.approvedAt, approvalDecision: operation.approvalDecision }
          : (this.requestsWrite(operation, task) ? "write request is within enabled provider authority" : "read-only/internal command")
      });
    }

    const blockers = checks.filter(check => check.ok !== true);
    const allowedToQueue = blockers.length === 0;

    return {
      ok: allowedToQueue,
      allowedToQueue,
      status: allowedToQueue ? "PREFLIGHT_READY" : "PREFLIGHT_BLOCKED",
      generatedAt,
      operationId: operation.id || null,
      command: operation.command || task.payload?.command || null,
      action: operation.action || task.type || task.payload?.action || null,
      providers: this.requiredProviders(operation, task),
      writeRequested: this.requestsWrite(operation, task),
      approvalRequired,
      approvalSatisfied,
      executionRoute: checks.find(check => check.area === "ACTION")?.route || null,
      checks,
      blockers
    };
  }
}

module.exports = CommandPreflightService;
