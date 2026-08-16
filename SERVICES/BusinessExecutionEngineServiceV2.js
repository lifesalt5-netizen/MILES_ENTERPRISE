"use strict";

const fs = require("fs");
const path = require("path");

const BusinessWorkPlannerService = require("./BusinessWorkPlannerService");
const BusinessOperationsBridgeService = require("./BusinessOperationsBridgeService");
const CompanyStateService = require("./CompanyStateService");
const TaskRouterService = require("./TaskRouterService");
const ExecutiveDashboardService = require("./ExecutiveDashboardService");

const ROOT = process.env.MILES_ROOT || path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "DATA", "business_execution");
const LATEST_FILE = path.join(OUT_DIR, "latest_business_execution.json");
const HISTORY_FILE = path.join(OUT_DIR, "business_execution_history.jsonl");

function now() { return new Date().toISOString(); }
function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function writeJsonAtomic(file, value) {
  ensureDir(path.dirname(file));
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), "utf8");
  try { fs.renameSync(temp, file); }
  catch {
    fs.copyFileSync(temp, file);
    try { fs.unlinkSync(temp); } catch {}
  }
}
function appendJsonLine(file, value) {
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, `${JSON.stringify(value)}\n`, "utf8");
}

function normalizeTask(task = {}) {
  const payload = task.payload || {};
  const plan = payload.plan || task.plan || {};
  return {
    task,
    payload,
    plan,
    objective:
      plan.objective || payload.objective || payload.command ||
      task.objective || task.command || task.title || "",
    originalCommand:
      plan.originalCommand || payload.originalCommand || payload.command ||
      task.command || task.title || "",
    steps: Array.isArray(plan.steps) && plan.steps.length
      ? plan.steps
      : [{
          step: 1,
          provider: "MILES",
          connector: "MILES",
          capability: "COMPANY_STATE",
          action: "COMPANY_STATE",
          objective: "Review current P2GC operating state and priorities."
        }]
  };
}

function invoke(service, input) {
  if (service && typeof service.execute === "function") return service.execute(input);
  if (service && typeof service.run === "function") return service.run(input);
  if (service && typeof service.report === "function") return service.report(input);
  throw new Error("Registered business execution service has no execute(), run(), or report() method.");
}

class BusinessExecutionEngineServiceV2 {
  constructor(options = {}) {
    this.bridge = options.bridge || new BusinessOperationsBridgeService({ rootDir: ROOT });

    this.services = {
      COMPANY_STATE: options.companyState || CompanyStateService,
      TASK_ROUTER: options.taskRouter || TaskRouterService,
      EXECUTIVE_DASHBOARD: options.executiveDashboard || ExecutiveDashboardService
    };

    this.lazyServicePaths = {
      PROVIDER_AUTHORITY: "./ProviderAuthorityRegistryService",
      PROVIDER_SYNC: "./ProviderSynchronizationService",
      INSTANTLY_LIVE: "./InstantlyLiveIntegrationService",
      CONTROLLED_WRITE: "./ControlledWriteService"
    };

    if (options.providerAuthority) this.services.PROVIDER_AUTHORITY = options.providerAuthority;
    if (options.providerSync) this.services.PROVIDER_SYNC = options.providerSync;
    if (options.instantlyLive) this.services.INSTANTLY_LIVE = options.instantlyLive;
    if (options.controlledWrite) this.services.CONTROLLED_WRITE = options.controlledWrite;
  }

  resolveService(action) {
    if (this.services[action]) return this.services[action];
    const modulePath = this.lazyServicePaths[action];
    if (!modulePath) return null;
    const service = require(modulePath);
    this.services[action] = service;
    return service;
  }

  isReadOnly(normalized = {}) {
    return Boolean(
      BusinessWorkPlannerService.isReadOnlyReview &&
      BusinessWorkPlannerService.isReadOnlyReview(
        normalized.originalCommand || normalized.objective || ""
      )
    );
  }

  async run(task = {}) {
    const normalized = normalizeTask(task);
    const executionId = `BIZ-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const record = {
      ok: true,
      status: "RUNNING",
      service: "BusinessExecutionEngineServiceV2",
      executionId,
      taskId: task.id || null,
      objective: normalized.objective,
      originalCommand: normalized.originalCommand,
      readOnly: this.isReadOnly(normalized),
      startedAt: now(),
      completedAt: null,
      stepCount: normalized.steps.length,
      completedSteps: 0,
      failedSteps: 0,
      approvalSteps: 0,
      blockedSteps: 0,
      results: [],
      executiveSummary: null
    };

    for (const step of normalized.steps) {
      const result = await this.executeStep(step, normalized, executionId);
      record.results.push(result);
      if (result.status === "COMPLETED") record.completedSteps += 1;
      else if (result.status === "AWAITING_APPROVAL") record.approvalSteps += 1;
      else if (result.status === "BLOCKED") record.blockedSteps += 1;
      else if (result.status === "FAILED") record.failedSteps += 1;
    }

    record.ok = record.failedSteps === 0;
    record.status = record.failedSteps > 0
      ? "COMPLETED_WITH_ERRORS"
      : record.approvalSteps > 0
        ? "AWAITING_APPROVAL"
        : "COMPLETED";
    record.completedAt = now();
    record.executiveSummary = this.buildExecutiveSummary(record);

    this.save(record);
    return record;
  }

  async execute(task = {}) {
    return this.run(task);
  }

  async executeStep(step = {}, normalized, executionId) {
    const action = String(step.action || step.capability || "").trim().toUpperCase();
    const readOnly = this.isReadOnly(normalized);
    const base = {
      step: Number(step.step || 0),
      action,
      provider: step.provider || "MILES",
      connector: step.connector || "MILES",
      objective: step.objective || normalized.objective,
      executionId,
      readOnly,
      startedAt: now(),
      completedAt: null,
      status: "RUNNING",
      result: null,
      error: null
    };

    try {
      if (action === "BUSINESS_EXECUTION") {
        return await this.planAndBridgeBusinessWork(base, normalized);
      }

      if (action === "TASK_ROUTER" && readOnly) {
        base.status = "COMPLETED";
        base.result = {
          ok: true,
          status: "READ_ONLY_ROUTE_SKIPPED",
          routed: 0,
          reason: "The CEO requested a read-only review; MILES did not route or create follow-on execution work."
        };
        base.completedAt = now();
        return base;
      }

      const service = this.resolveService(action);
      if (!service) {
        base.status = "FAILED";
        base.error = `No canonical business execution service is registered for action ${action}.`;
        base.completedAt = now();
        return base;
      }

      const stepTask = {
        ...normalized.task,
        action,
        capability: step.capability || action,
        provider: step.provider || "MILES",
        connector: step.connector || "MILES",
        objective: base.objective,
        payload: {
          ...normalized.payload,
          action,
          capability: step.capability || action,
          provider: step.provider || "MILES",
          connector: step.connector || "MILES",
          objective: base.objective,
          originalObjective: normalized.objective,
          parentExecutionId: executionId
        }
      };

      const result = await invoke(service, stepTask);
      const status = String(result?.status || result?.action || "").toUpperCase();
      const awaitingApproval =
        status === "AWAITING_APPROVAL" || status === "AWAITING_CEO_APPROVAL";

      base.result = result;
      base.status = awaitingApproval
        ? "AWAITING_APPROVAL"
        : result?.ok === false
          ? "FAILED"
          : "COMPLETED";
      base.error = base.status === "FAILED"
        ? result?.error || result?.message || `${action} returned failure.`
        : null;
      base.completedAt = now();
      return base;
    } catch (error) {
      base.status = "FAILED";
      base.error = error.message;
      base.completedAt = now();
      return base;
    }
  }

  async planAndBridgeBusinessWork(base, normalized) {
    const workPlan = await BusinessWorkPlannerService.plan({
      objective: normalized.objective,
      payload: normalized.payload
    });

    const workPackages = Array.isArray(workPlan.workPackages)
      ? workPlan.workPackages
      : [];
    const recommendedActions = Array.isArray(workPlan.recommendations)
      ? workPlan.recommendations
      : [];

    if (!workPlan.ok) {
      base.status = "FAILED";
      base.error = "BusinessWorkPlannerService failed to produce a valid plan.";
      base.completedAt = now();
      return base;
    }

    if (workPlan.readOnly === true || workPlan.mode === "READ_ONLY_REVIEW") {
      base.status = "COMPLETED";
      base.result = {
        ok: true,
        service: workPlan.service,
        mode: "READ_ONLY_REVIEW",
        readOnly: true,
        objective: normalized.objective,
        recommendations: recommendedActions,
        recommendationCount: recommendedActions.length,
        workPackageCount: 0,
        operationsCreated: 0,
        operationsQueued: 0,
        operationsAwaitingApproval: 0,
        operationsFailed: 0,
        tasks: [],
        workPackages: [],
        generatedAt: workPlan.generatedAt
      };
      base.completedAt = now();
      return base;
    }

    if (workPackages.length === 0) {
      base.status = "FAILED";
      base.error = "Execution-mode business plan returned no executable work packages.";
      base.completedAt = now();
      return base;
    }

    const invalidPackages = workPackages.filter(item => {
      const connector = String(item?.connector || item?.provider || "").toUpperCase();
      return !["MILES", "INSTANTLY", "ORION"].includes(connector);
    });

    if (invalidPackages.length) {
      base.status = "FAILED";
      base.error = `Business plan contains non-canonical connector identities: ${invalidPackages.map(item => item.connector || item.provider).join(", ")}`;
      base.completedAt = now();
      return base;
    }

    const queue = this.bridge.readQueue();
    queue.operations = Array.isArray(queue.operations) ? queue.operations : [];

    const created = workPackages.map((workPackage, index) => {
      const provider = String(workPackage.provider || workPackage.connector || "MILES").toUpperCase();
      const connector = String(workPackage.connector || provider).toUpperCase();
      const action = workPackage.action || workPackage.taskType || "BUSINESS_OPERATION";
      return {
        id: `${base.executionId}-WORK-${String(index + 1).padStart(3, "0")}`,
        source: "BusinessExecutionEngineServiceV2",
        sourceExecutionId: base.executionId,
        department: workPackage.department || "Revenue",
        provider,
        connector,
        system: workPackage.system || connector,
        action,
        capability: workPackage.capability || action,
        type: workPackage.taskType || action,
        taskType: workPackage.taskType || action,
        title: workPackage.title || workPackage.description || action,
        command: workPackage.command || workPackage.description || normalized.objective,
        objective: workPackage.objective || workPackage.description || normalized.objective,
        description: workPackage.description || "",
        priority: workPackage.priority || index + 1,
        readOnly: workPackage.readOnly === true,
        requiresKevin: workPackage.requiresKevin === true,
        status: workPackage.requiresKevin === true ? "AWAITING_APPROVAL" : "READY",
        plan: {
          ...workPackage,
          provider,
          connector,
          system: workPackage.system || connector,
          action,
          capability: workPackage.capability || action,
          objective: workPackage.objective || workPackage.description || normalized.objective,
          originalCommand: normalized.originalCommand
        },
        createdAt: now(),
        updatedAt: now()
      };
    });

    queue.operations.push(...created);
    this.bridge.writeQueue(queue);

    let queued = 0;
    let failed = 0;
    let awaitingApproval = 0;
    const tasks = [];

    for (const operation of created) {
      if (operation.requiresKevin) {
        awaitingApproval += 1;
        continue;
      }
      try {
        const task = this.bridge.enqueueTask(operation);
        this.bridge.markOperation(operation.id, {
          status: "BRIDGED",
          bridgedAt: now(),
          taskQueueStatus: "QUEUED",
          taskId: task.id || null
        });
        queued += 1;
        tasks.push({ operationId: operation.id, taskId: task.id || null });
      } catch (error) {
        failed += 1;
        this.bridge.markOperation(operation.id, {
          status: "BRIDGE_FAILED",
          bridgeFailedAt: now(),
          taskQueueStatus: "FAILED",
          error: error.message
        });
        tasks.push({ operationId: operation.id, taskId: null, error: error.message });
      }
    }

    base.result = {
      ok: failed === 0,
      service: workPlan.service,
      mode: workPlan.mode || "EXECUTION",
      readOnly: false,
      objective: normalized.objective,
      recommendations: recommendedActions,
      recommendationCount: recommendedActions.length,
      workPackageCount: workPackages.length,
      operationsCreated: created.length,
      operationsQueued: queued,
      operationsAwaitingApproval: awaitingApproval,
      operationsFailed: failed,
      tasks,
      workPackages,
      generatedAt: workPlan.generatedAt
    };
    base.status = failed > 0
      ? "FAILED"
      : awaitingApproval > 0 && queued === 0
        ? "AWAITING_APPROVAL"
        : "COMPLETED";
    base.error = failed > 0
      ? `${failed} business operation(s) failed while entering TaskQueue.`
      : null;
    base.completedAt = now();
    return base;
  }

  buildExecutiveSummary(record) {
    const companyState = record.results.find(item => item.action === "COMPANY_STATE")?.result;
    const businessWork = record.results.find(item => item.action === "BUSINESS_EXECUTION")?.result;
    const dashboard = record.results.find(item => item.action === "EXECUTIVE_DASHBOARD")?.result;

    const priorities = [];
    const seen = new Set();
    const addPriority = (item = {}, defaultArea = "Executive", defaultReason = null) => {
      const title = item.title || item.description || item.taskType || item.action || item.reason || "Executive priority";
      const key = String(title).toLowerCase();
      if (seen.has(key) || priorities.length >= 3) return;
      seen.add(key);
      priorities.push({
        priority: priorities.length + 1,
        area: item.area || item.provider || defaultArea,
        title,
        reason: item.reason || defaultReason
      });
    };

    for (const item of Array.isArray(companyState?.priorities) ? companyState.priorities : []) {
      addPriority(item, "Executive");
    }

    if (priorities.length < 3) {
      for (const item of Array.isArray(businessWork?.recommendations) ? businessWork.recommendations : []) {
        addPriority(item, "Revenue", "Generated from the canonical executive business review.");
      }
    }

    if (priorities.length < 3) {
      for (const item of Array.isArray(businessWork?.workPackages) ? businessWork.workPackages : []) {
        addPriority(item, "Operations", "Generated from the canonical business work plan.");
      }
    }

    const readOnly = businessWork?.readOnly === true || record.readOnly === true;

    return {
      ok: record.failedSteps === 0,
      objective: record.objective,
      status: record.status,
      readOnly,
      topActions: priorities.slice(0, 3),
      completedSteps: record.completedSteps,
      failedSteps: record.failedSteps,
      approvalSteps: record.approvalSteps,
      workQueued: Number(businessWork?.operationsQueued || 0),
      dashboardSummary: dashboard?.summary || null,
      message: record.failedSteps > 0
        ? "MILES completed the executive mission with one or more step failures."
        : readOnly
          ? "MILES completed the read-only executive review and returned prioritized recommendations without queuing or changing external systems."
          : "MILES reviewed the operating state, produced prioritized actions, and routed authorized work through the canonical execution queue."
    };
  }

  save(record) {
    ensureDir(OUT_DIR);
    writeJsonAtomic(LATEST_FILE, record);
    appendJsonLine(HISTORY_FILE, record);
  }
}

module.exports = new BusinessExecutionEngineServiceV2();
module.exports.BusinessExecutionEngineServiceV2 = BusinessExecutionEngineServiceV2;
