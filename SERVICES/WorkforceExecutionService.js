"use strict";

const fs = require("fs");
const path = require("path");

const eventBus = require("./Events/EventBus");
const EventTypes = require("./Events/EventTypes");

const workforce = require("./WorkforceService");
const executiveState = require("./ExecutiveStateService");
const providerRouter = require("./ProviderRouterService");
const decisionEngine = require("./Decision/DecisionEngine");
const executionPlanService = require("./ExecutionPlanService");
const { log } = require("../CORE/logger");

const ROOT = process.env.MILES_ROOT || "D:\\P2GC_Intelligence\\MILES_OS";
const RESULTS_DIR = path.join(ROOT, "DATA", "workforce_results");

let instantlyOperator = null;

try {
  instantlyOperator = require("./Browser/Workers/InstantlyCampaignOperator");
} catch {
  instantlyOperator = null;
}

function safeId(value) {
  return String(value || "UNKNOWN")
    .replace(/[^a-z0-9_-]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
}

function ensureDirs() {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
}

function findEmployee(name) {
  const target = String(name || "").toLowerCase();

  return workforce.all().find(e =>
    String(e.name || e.employee || e.id || "").toLowerCase() === target
  ) || null;
}

function publishSafe(type, payload = {}, metadata = {}) {
  try {
    eventBus.publish(type, payload, metadata);
  } catch (err) {
    log("WorkforceExecutionService", "Publish event", "Failed", err.message);
  }
}

function textOf(task = {}) {
  const payload = task.payload || task || {};

  return [
    task.id,
    task.type,
    payload.provider,
    payload.capability,
    payload.action,
    payload.objective,
    payload.expectedOutput,
    payload.verification,
    payload.department
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function isInstantlyTask(task = {}) {
  const text = textOf(task);

  return /instantly|campaign|deliverability|bounce|inbox|lead upload|email outreach|paused campaign|active campaign/.test(text);
}

function shouldRunInstantlyBrowserOperator(task = {}) {
  const payload = task.payload || task || {};
  const text = textOf(task);

  if (!instantlyOperator) return false;

  if (/generateexecutiveupdate|executive\.update\.generate/.test(text)) {
    return false;
  }

  if (
    String(payload.action || "").toLowerCase() === "readcampaigns" ||
    String(payload.capability || "").toLowerCase().includes("instantly.read") ||
    String(payload.capability || "").toLowerCase().includes("campaign.audit") ||
    String(payload.capability || "").toLowerCase().includes("deliverability") ||
    String(payload.provider || "").toLowerCase() === "instantly"
  ) {
    return true;
  }

  return /run instantly coo operator|campaign readiness|paused instantly|active instantly|audit campaigns/.test(text);
}

function defaultRecommendation(task, employee) {
  const payload = task.payload || {};
  const capability = payload.capability || task.type || "general";
  const objective = payload.objective || "No objective provided";
  const workerName = payload.assignedTo || employee?.name || employee?.employee || "MILES";
  const expectedOutput = payload.expectedOutput || `${capability} recommendation`;

  return {
    summary: `${workerName} prepared ${expectedOutput} for: ${objective}`,
    recommendation: `Proceed with the next operational step for ${capability}.`,
    nextActions: [
      `Review current state for ${capability}.`,
      "Confirm available source data.",
      "Escalate only if CEO approval rules are triggered."
    ],
    needsHumanInput: false,
    ceoApprovalRequired: false
  };
}

class WorkforceExecutionService {
  constructor() {
    this.operatorCache = {};
  }

  async executeStep(task = {}) {
    ensureDirs();

    const payload = task.payload || {};
    const employee = findEmployee(payload.assignedTo);

    publishSafe(EventTypes.EXECUTION_STARTED, {
      taskId: task.id || null,
      type: task.type || null,
      payload
    }, {
      source: "WorkforceExecutionService",
      taskId: task.id || null,
      workPackageId: payload.workPackageId || null
    });

    let providerResult = null;
    let automationResult = null;

    if (payload.provider && providerRouter.hasProvider(payload.provider)) {
      providerResult = await providerRouter.executeProviderTask(task);

      publishSafe(EventTypes.PROVIDER_EXECUTED, {
        taskId: task.id || null,
        provider: payload.provider,
        action: payload.action || null,
        capability: payload.capability || null,
        providerResult
      }, {
        source: "WorkforceExecutionService",
        taskId: task.id || null,
        workPackageId: payload.workPackageId || null
      });
    }

    if (shouldRunInstantlyBrowserOperator(task)) {
      automationResult = await this.runInstantlyOperator(task);

      publishSafe("provider.browser_operator.executed", {
        taskId: task.id || null,
        provider: payload.provider || null,
        action: payload.action || null,
        capability: payload.capability || null,
        automationResult
      }, {
        source: "WorkforceExecutionService",
        taskId: task.id || null,
        workPackageId: payload.workPackageId || null
      });

      providerResult = this.mergeAutomationResult(providerResult, automationResult, task);
    }

    let decision = null;
    let executionPlan = null;

    if (providerResult) {
      decision = decisionEngine.evaluate({
        objective: payload.objective,
        provider: payload.provider,
        action: payload.action,
        capability: payload.capability,
        providerResult,
        exceptions: providerResult.exceptions || [],
        recommendations: providerResult.recommendations || []
      });

      publishSafe(EventTypes.DECISION_COMPLETED, {
        taskId: task.id || null,
        provider: payload.provider,
        action: payload.action || null,
        capability: payload.capability || null,
        decision
      }, {
        source: "WorkforceExecutionService",
        taskId: task.id || null,
        workPackageId: payload.workPackageId || null
      });

      executionPlan = executionPlanService.create({
        taskId: task.id || null,
        payload,
        providerResult,
        decision
      });
    }

    const output = providerResult
      ? {
          summary: `${providerResult.provider || payload.provider} executed ${payload.action || "refresh"}.`,
          recommendation: this.buildProviderRecommendation(providerResult, decision, executionPlan),
          nextActions: executionPlan?.nextActions || providerResult.recommendations || [],
          needsHumanInput: executionPlan?.executionMode === "CEO_APPROVAL_REQUIRED",
          ceoApprovalRequired: executionPlan?.executionMode === "CEO_APPROVAL_REQUIRED",
          providerResult,
          automationResult,
          decision,
          executionPlan
        }
      : defaultRecommendation(task, employee);

    const result = {
      ok: providerResult ? Boolean(providerResult.ok && executionPlan?.canExecute) : true,
      type: "WORKFORCE_STEP_RESULT",
      executionMode: providerResult ? executionPlan.executionMode : "WORKFORCE_RECOMMENDATION",
      taskId: task.id || null,
      workPackageId: payload.workPackageId || null,
      objective: payload.objective || null,
      capability: payload.capability || null,
      provider: payload.provider || null,
      action: payload.action || null,
      assignedTo: payload.assignedTo || null,
      department: payload.department || employee?.department || null,
      expectedOutput: payload.expectedOutput || null,
      verification: payload.verification || null,
      employeeFound: Boolean(employee),
      employeeProfile: employee ? {
        name: employee.name || employee.employee || employee.id,
        department: employee.department || "",
        mission: employee.mission || "",
        authority: employee.authority || "Operational"
      } : null,
      output,
      status: this.resolveStatus(providerResult, executionPlan),
      createdAt: new Date().toISOString()
    };

    const fileName = `${safeId(result.workPackageId || "WP")}_${safeId(result.taskId || Date.now())}.json`;
    const outFile = path.join(RESULTS_DIR, fileName);

    fs.writeFileSync(outFile, JSON.stringify(result, null, 2));

    this.updateExecutiveState(result, outFile);

    publishSafe(EventTypes.EXECUTION_COMPLETED, {
      taskId: result.taskId,
      workPackageId: result.workPackageId,
      provider: result.provider,
      action: result.action,
      capability: result.capability,
      executionMode: result.executionMode,
      status: result.status,
      outFile
    }, {
      source: "WorkforceExecutionService",
      taskId: result.taskId,
      workPackageId: result.workPackageId
    });

    log("WorkforceExecutionService", "Execute workforce step", "Success", outFile);

    return { ...result, outFile };
  }

  async runInstantlyOperator(task = {}) {
    const payload = task.payload || task || {};
    const cacheKey = payload.workPackageId || task.id || "GLOBAL_INSTANTLY_OPERATOR";

    if (this.operatorCache[cacheKey]) {
      return {
        ...this.operatorCache[cacheKey],
        cached: true
      };
    }

    if (!instantlyOperator || typeof instantlyOperator.run !== "function") {
      return {
        ok: false,
        provider: "InstantlyBrowserOperator",
        status: "NOT_AVAILABLE",
        exceptions: [
          {
            type: "InstantlyBrowserOperator",
            severity: "Warning",
            message: "InstantlyCampaignOperator is not available or does not expose run()."
          }
        ],
        recommendations: [
          "Verify SERVICES/Browser/Workers/InstantlyCampaignOperator.js exists and exports a runnable operator."
        ]
      };
    }

    try {
      const operatorResult = await instantlyOperator.run({
        execute: true,
        headless: true,
        sourceTaskId: task.id || null,
        workPackageId: payload.workPackageId || null
      });

      const normalized = {
        ok: Boolean(operatorResult.ok),
        provider: "InstantlyBrowserOperator",
        status: operatorResult.stage || (operatorResult.ok ? "COMPLETED" : "FAILED"),
        campaigns: operatorResult.campaigns || [],
        actions: operatorResult.actions || {},
        diagnostics: operatorResult.diagnostics || {},
        screenshots: operatorResult.screenshots || [],
        file: operatorResult.file || null,
        exceptions: (operatorResult.errors || []).map(error => ({
          type: "InstantlyBrowserOperator",
          severity: "Warning",
          message: String(error)
        })),
        recommendations: this.buildInstantlyRecommendations(operatorResult),
        raw: operatorResult
      };

      this.operatorCache[cacheKey] = normalized;
      return normalized;
    } catch (err) {
      const failed = {
        ok: false,
        provider: "InstantlyBrowserOperator",
        status: "FAILED",
        exceptions: [
          {
            type: "InstantlyBrowserOperator",
            severity: "Critical",
            message: err.stack || err.message
          }
        ],
        recommendations: [
          "Review browser session, Instantly login state, and campaign operator output."
        ]
      };

      this.operatorCache[cacheKey] = failed;
      return failed;
    }
  }

  buildInstantlyRecommendations(operatorResult = {}) {
    const campaigns = operatorResult.campaigns || [];
    const actions = operatorResult.actions || {};

    const drafts = campaigns.filter(c => String(c.status).toLowerCase() === "draft");
    const paused = campaigns.filter(c => String(c.status).toLowerCase() === "paused");
    const active = campaigns.filter(c => String(c.status).toLowerCase() === "active");

    const recommendations = [];

    if (drafts.length > 0) {
      recommendations.push(`Inspect ${drafts.length} draft Instantly campaign(s) for leads, inbox assignment, sequence, schedule, and launch readiness.`);
    }

    if (paused.length > 0) {
      recommendations.push(`Diagnose ${paused.length} paused Instantly campaign(s) for bounce, domain, inbox, or lead issues before resuming.`);
    }

    if (active.length > 0) {
      recommendations.push(`Monitor ${active.length} active Instantly campaign(s) for bounce rate, reply rate, lead exhaustion, and inbox capacity.`);
    }

    if ((actions.failed || []).length > 0) {
      recommendations.push(`Review ${actions.failed.length} failed Instantly action(s).`);
    }

    if (recommendations.length === 0) {
      recommendations.push("Instantly campaign inventory was captured successfully. Continue monitoring.");
    }

    return recommendations;
  }

  mergeAutomationResult(providerResult, automationResult, task = {}) {
    const payload = task.payload || task || {};

    if (!providerResult) {
      return {
        ok: Boolean(automationResult?.ok),
        type: "PROVIDER_EXECUTION_RESULT",
        provider: payload.provider || "Instantly",
        action: payload.action || "runInstantlyOperator",
        taskId: task.id || null,
        workPackageId: payload.workPackageId || null,
        objective: payload.objective || null,
        capability: payload.capability || null,
        assignedTo: payload.assignedTo || "MILES",
        department: payload.department || null,
        status: automationResult?.status || "UNKNOWN",
        dataFreshness: "Live Browser",
        lastRefresh: new Date().toISOString(),
        metrics: {
          browserCampaigns: automationResult?.campaigns?.length || 0,
          browserActions: automationResult?.actions || {},
          browserDiagnostics: automationResult?.diagnostics || {}
        },
        exceptions: automationResult?.exceptions || [],
        recommendations: automationResult?.recommendations || [],
        evidence: {
          providerLoaded: true,
          browserOperatorExecuted: true,
          browserResultFile: automationResult?.file || null,
          screenshots: automationResult?.screenshots || []
        },
        completedAt: new Date().toISOString()
      };
    }

    return {
      ...providerResult,
      ok: Boolean(providerResult.ok && automationResult?.ok !== false),
      metrics: {
        ...(providerResult.metrics || {}),
        browserCampaigns: automationResult?.campaigns?.length || 0,
        browserActions: automationResult?.actions || {},
        browserDiagnostics: automationResult?.diagnostics || {}
      },
      exceptions: [
        ...(providerResult.exceptions || []),
        ...(automationResult?.exceptions || [])
      ],
      recommendations: [
        ...(providerResult.recommendations || []),
        ...(automationResult?.recommendations || [])
      ],
      evidence: {
        ...(providerResult.evidence || {}),
        browserOperatorExecuted: true,
        browserResultFile: automationResult?.file || null,
        screenshots: automationResult?.screenshots || []
      }
    };
  }

  resolveStatus(providerResult, executionPlan) {
    if (!providerResult) return "AWAITING_VERIFICATION";
    if (!providerResult.ok) return "NEEDS_REVIEW";
    if (executionPlan?.executionMode === "CEO_APPROVAL_REQUIRED") return "AWAITING_CEO_APPROVAL";
    return "AWAITING_VERIFICATION";
  }

  buildProviderRecommendation(providerResult = {}, decision = {}, executionPlan = {}) {
    if (!providerResult.ok) {
      return `Provider execution failed or needs review: ${providerResult.provider}`;
    }

    if (decision?.decision === "ESCALATE") {
      return "Provider executed, but MILES decision engine requires CEO approval before further action.";
    }

    const exceptions = providerResult.exceptions || [];

    if (exceptions.length > 0) {
      return `${providerResult.provider} executed successfully but returned ${exceptions.length} exception(s). Review before autonomous action.`;
    }

    return `${providerResult.provider} executed successfully. Decision approved for autonomous verification and reporting.`;
  }

  updateExecutiveState(result, outFile) {
    const current = executiveState.get() || {};
    const workforceResults = current.workforceResults || [];

    workforceResults.push({
      taskId: result.taskId,
      workPackageId: result.workPackageId,
      capability: result.capability,
      provider: result.provider,
      action: result.action,
      assignedTo: result.assignedTo,
      executionMode: result.executionMode,
      status: result.status,
      outFile,
      createdAt: result.createdAt
    });

    executiveState.update("workforceResults", workforceResults.slice(-250));
  }

  verifyResult(result = {}) {
    const hasRecommendation = Boolean(result.output && result.output.recommendation);
    const providerFailed = result.executionMode === "AUTONOMOUS" && result.ok === false;
    const needsApproval = result.executionMode === "CEO_APPROVAL_REQUIRED";

    const verified = {
      ok: hasRecommendation && !providerFailed && !needsApproval,
      type: "WORKFORCE_STEP_VERIFICATION",
      taskId: result.taskId || null,
      workPackageId: result.workPackageId || null,
      capability: result.capability || null,
      provider: result.provider || null,
      action: result.action || null,
      assignedTo: result.assignedTo || null,
      verified: hasRecommendation && !providerFailed && !needsApproval,
      status:
        needsApproval ? "AWAITING_CEO_APPROVAL" :
        hasRecommendation && !providerFailed ? "COMPLETED" :
        "NEEDS_REVIEW",
      evidence: {
        executionMode: result.executionMode || "UNKNOWN",
        hasOutput: Boolean(result.output),
        hasRecommendation,
        providerFailed,
        needsApproval
      },
      checkedAt: new Date().toISOString()
    };

    const current = executiveState.get() || {};
    const verifications = current.verifications || [];

    verifications.push(verified);
    executiveState.update("verifications", verifications.slice(-250));

    publishSafe(EventTypes.VERIFICATION_COMPLETED, verified, {
      source: "WorkforceExecutionService",
      taskId: verified.taskId,
      workPackageId: verified.workPackageId
    });

    return verified;
  }

  async executeAndVerify(task = {}) {
    try {
      const result = await this.executeStep(task);
      const verification = this.verifyResult(result);

      return {
        ok: verification.verified,
        result,
        verification,
        status: verification.status
      };
    } catch (err) {
      publishSafe(EventTypes.EXECUTION_FAILED, {
        taskId: task.id || null,
        workPackageId: task.payload?.workPackageId || null,
        error: err.stack || err.message
      }, {
        source: "WorkforceExecutionService",
        taskId: task.id || null,
        workPackageId: task.payload?.workPackageId || null
      });

      throw err;
    }
  }
}

module.exports = new WorkforceExecutionService();