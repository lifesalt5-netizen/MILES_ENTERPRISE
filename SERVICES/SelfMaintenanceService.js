"use strict";

/*
  MILES OS
  File: SERVICES/SelfMaintenanceService.js
  Purpose:
    Self-maintenance, health diagnosis, safe repair planning, and executive reporting.
*/

const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT || process.cwd();

function now() {
  return new Date().toISOString();
}

function safeReadJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function safeWriteJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

function fileExists(file) {
  try {
    return fs.existsSync(file);
  } catch {
    return false;
  }
}

class SelfMaintenanceService {
  constructor(options = {}) {
    this.rootDir = options.rootDir || ROOT;

    this.runtimeDir = path.join(this.rootDir, "DATA", "runtime");
    this.reportDir = path.join(this.rootDir, "DATA", "self_maintenance");

    this.taskQueueFile = path.join(this.runtimeDir, "task_queue.json");
    this.workQueueFile = path.join(this.runtimeDir, "work_queue.json");
    this.businessQueueFile = path.join(this.rootDir, "state", "business_operations_queue.json");

    this.requiredFiles = [
      "SERVICES/CommandIntentPlannerService.js",
      "SERVICES/ExecutionService.js",
      "SERVICES/EngineeringImprovementService.js",
      "SERVICES/ExecutiveResponseService.js",
      "SERVICES/digital_coo/MilesCommandCenter.js",
      "BUILDER/BuilderService.js",
      "BUILDER/index.js",
      "CONNECTORS/MILES/connector.js",
      "CONNECTORS/ORION/connector.js",
      "CORE/ConnectorManager.js",
      "CORE/TaskQueue.js"
    ];
  }

  inspectFiles() {
    return this.requiredFiles.map((relativePath) => {
      const fullPath = path.join(this.rootDir, relativePath);
      const exists = fileExists(fullPath);
      const text = exists ? fs.readFileSync(fullPath, "utf8") : "";

      return {
        file: relativePath,
        exists,
        size: text.length,
        hasModuleExport: /module\.exports/.test(text),
        hasRunOrExecute:
          /run\s*\(/.test(text) ||
          /execute\s*\(/.test(text) ||
          /plan\s*\(/.test(text),
        checkedAt: now()
      };
    });
  }

  inspectTaskQueue() {
    const tasks = safeReadJson(this.taskQueueFile, []);

    const list = Array.isArray(tasks) ? tasks : [];

    return {
      total: list.length,
      queued: list.filter((t) => t.status === "QUEUED").length,
      running: list.filter((t) => t.status === "RUNNING").length,
      completed: list.filter((t) => t.status === "COMPLETED").length,
      failed: list.filter((t) => t.status === "FAILED").length,
      awaitingApproval: list.filter((t) => t.status === "AWAITING_APPROVAL").length,
      recentFailed: list
        .filter((t) => t.status === "FAILED")
        .slice(-10)
        .map((t) => ({
          id: t.id,
          type: t.type,
          provider: t.provider || t.payload?.provider,
          connector: t.connector || t.payload?.connector,
          action: t.action || t.payload?.action,
          error: t.error || t.result?.error,
          updatedAt: t.updatedAt
        }))
    };
  }

  inspectBusinessQueue() {
    const queue = safeReadJson(this.businessQueueFile, {
      generatedAt: null,
      operations: []
    });

    const operations = Array.isArray(queue.operations) ? queue.operations : [];

    return {
      total: operations.length,
      ready: operations.filter((o) => o.status === "READY").length,
      waitingForApproval: operations.filter((o) => o.status === "WAITING_FOR_CEO_APPROVAL").length,
      completed: operations.filter((o) => o.status === "COMPLETED").length,
      failed: operations.filter((o) => o.status === "FAILED").length,
      newest: operations.slice(0, 5).map((o) => ({
        id: o.id,
        type: o.type,
        status: o.status,
        provider: o.provider,
        connector: o.connector,
        action: o.action,
        title: o.title,
        createdAt: o.createdAt
      }))
    };
  }

  inspectCapabilities() {
    const builderPath = path.join(this.rootDir, "BUILDER", "BuilderService.js");
    const plannerPath = path.join(this.rootDir, "SERVICES", "CommandIntentPlannerService.js");
    const executionPath = path.join(this.rootDir, "SERVICES", "ExecutionService.js");

    const builder = fileExists(builderPath) ? fs.readFileSync(builderPath, "utf8") : "";
    const planner = fileExists(plannerPath) ? fs.readFileSync(plannerPath, "utf8") : "";
    const execution = fileExists(executionPath) ? fs.readFileSync(executionPath, "utf8") : "";

    const expectedActions = [
      "ENGINEERING_IMPROVEMENT",
      "ENGINEERING_ANALYZE",
      "ENGINEERING_PLAN",
      "ENGINEERING_IMPLEMENT",
      "ENGINEERING_VALIDATE",
      "ENGINEERING_REPORT",
      "WEBSITE_REVIEW",
      "ORION_HEALTH"
    ];

    return expectedActions.map((action) => ({
      action,
      inBuilder: builder.includes(action),
      inPlanner: planner.includes(action),
      inExecution: execution.includes(action)
    }));
  }

  diagnose() {
    const files = this.inspectFiles();
    const taskQueue = this.inspectTaskQueue();
    const businessQueue = this.inspectBusinessQueue();
    const capabilities = this.inspectCapabilities();

    const findings = [];

    for (const file of files) {
      if (!file.exists) {
        findings.push({
          severity: "HIGH",
          area: "Files",
          issue: `Missing required file: ${file.file}`,
          recommendedAction: "Restore or recreate the missing file."
        });
      }
    }

    for (const cap of capabilities) {
      if (!cap.inBuilder && cap.action !== "ORION_HEALTH") {
        findings.push({
          severity: "MEDIUM",
          area: "Capabilities",
          issue: `${cap.action} is not registered in BuilderService.`,
          recommendedAction: `Register ${cap.action} in BuilderService.`
        });
      }
    }

    if (taskQueue.failed > 0) {
      findings.push({
        severity: "MEDIUM",
        area: "TaskQueue",
        issue: `${taskQueue.failed} failed task(s) found in runtime task queue.`,
        recommendedAction: "Review failed tasks and classify as stale, recoverable, or active."
      });
    }

    if (businessQueue.waitingForApproval > 0) {
      findings.push({
        severity: "LOW",
        area: "BusinessQueue",
        issue: `${businessQueue.waitingForApproval} operation(s) waiting for CEO approval.`,
        recommendedAction: "Review approval queue."
      });
    }

    return {
      ok: true,
      service: "SelfMaintenanceService",
      action: "SELF_MAINTENANCE_DIAGNOSE",
      status: findings.some((f) => f.severity === "HIGH") ? "DEGRADED" : "OK",
      files,
      taskQueue,
      businessQueue,
      capabilities,
      findings,
      checkedAt: now()
    };
  }

  planRepair(task = {}) {
    const diagnosis = this.diagnose();

    const repairPlan = diagnosis.findings.map((finding, index) => ({
      step: index + 1,
      severity: finding.severity,
      area: finding.area,
      issue: finding.issue,
      recommendedAction: finding.recommendedAction,
      safeToAutoRepair:
        finding.area === "Capabilities" ||
        finding.area === "TaskQueue",
      requiresApproval:
        finding.area === "Files"
    }));

    return {
      ok: true,
      service: "SelfMaintenanceService",
      action: "SELF_MAINTENANCE_PLAN",
      objective: task.payload?.objective || task.payload?.command || task.title || "",
      status: repairPlan.length ? "REPAIR_PLAN_CREATED" : "NO_REPAIR_NEEDED",
      repairPlan,
      plannedAt: now()
    };
  }

  validate() {
    const diagnosis = this.diagnose();

    const validation = {
      requiredFilesPresent: diagnosis.files.every((f) => f.exists),
      builderHasEngineeringImprovement:
        diagnosis.capabilities.find((c) => c.action === "ENGINEERING_IMPROVEMENT")?.inBuilder === true,
      plannerHasEngineeringImprovement:
        diagnosis.capabilities.find((c) => c.action === "ENGINEERING_IMPROVEMENT")?.inPlanner === true,
      executionHasEngineeringImprovement:
        diagnosis.capabilities.find((c) => c.action === "ENGINEERING_IMPROVEMENT")?.inExecution === true,
      taskQueueReadable: typeof diagnosis.taskQueue.total === "number",
      businessQueueReadable: typeof diagnosis.businessQueue.total === "number"
    };

    return {
      ok: Object.values(validation).every(Boolean),
      service: "SelfMaintenanceService",
      action: "SELF_MAINTENANCE_VALIDATE",
      validation,
      checkedAt: now()
    };
  }

  report(task = {}) {
    const diagnosis = this.diagnose();
    const plan = this.planRepair(task);
    const validation = this.validate();

    const report = {
      ok: true,
      service: "SelfMaintenanceService",
      action: "SELF_MAINTENANCE_REPORT",
      status: diagnosis.status,
      executiveSummary:
        diagnosis.status === "OK"
          ? "MILES OS self-maintenance check completed. No critical issues were detected."
          : "MILES OS self-maintenance check completed. One or more issues require attention.",
      diagnosis,
      repairPlan: plan.repairPlan,
      validation,
      recommendedNextAction:
        diagnosis.findings.length === 0
          ? "Continue normal operations."
          : diagnosis.findings[0].recommendedAction,
      completedAt: now()
    };

    const outFile = path.join(
      this.reportDir,
      `self_maintenance_report_${Date.now()}.json`
    );

    safeWriteJson(outFile, report);

    return {
      ...report,
      outFile
    };
  }

  run(task = {}) {
    const action = String(
      task.action ||
      task.type ||
      task.payload?.action ||
      task.payload?.plan?.action ||
      "SELF_MAINTENANCE"
    ).toUpperCase();

    if (action === "SELF_MAINTENANCE") {
      return this.report(task);
    }

    if (action === "SELF_MAINTENANCE_DIAGNOSE") {
      return this.diagnose(task);
    }

    if (action === "SELF_MAINTENANCE_PLAN") {
      return this.planRepair(task);
    }

    if (action === "SELF_MAINTENANCE_VALIDATE") {
      return this.validate(task);
    }

    if (action === "SELF_MAINTENANCE_REPORT") {
      return this.report(task);
    }

    return {
      ok: false,
      service: "SelfMaintenanceService",
      action,
      error: `Unsupported self-maintenance action: ${action}`,
      supportedActions: [
        "SELF_MAINTENANCE",
        "SELF_MAINTENANCE_DIAGNOSE",
        "SELF_MAINTENANCE_PLAN",
        "SELF_MAINTENANCE_VALIDATE",
        "SELF_MAINTENANCE_REPORT"
      ]
    };
  }
}

module.exports = new SelfMaintenanceService();