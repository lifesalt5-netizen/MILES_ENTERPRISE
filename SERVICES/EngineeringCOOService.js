"use strict";

const fs = require("fs");
const path = require("path");

const taskQueue = require("../CORE/TaskQueue");
const eventBus = require("../CORE/EventBus");
const { log } = require("../CORE/logger");

const SelfEngineeringService = require("./SelfEngineeringService");

const ROOT = process.env.MILES_ROOT || process.cwd();

const ENGINEERING_DIR = path.join(ROOT, "DATA", "engineering_coo");
const LATEST_REPORT = path.join(ENGINEERING_DIR, "latest_engineering_coo_report.json");
const LATEST_MD = path.join(ENGINEERING_DIR, "latest_engineering_coo_report.md");

function ensureDir() {
  fs.mkdirSync(ENGINEERING_DIR, { recursive: true });
}

function now() {
  return new Date().toISOString();
}

function safeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function classifyFailure(task = {}) {
  const payload = task.payload || {};
  const errorText = safeText(
    task.error ||
    task.result?.error ||
    task.result?.failure?.type ||
    payload.error ||
    ""
  );

  const combined = [
    task.id,
    task.type,
    task.status,
    task.provider,
    payload.provider,
    payload.system,
    payload.connector,
    payload.capability,
    payload.action,
    payload.objective,
    errorText
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/connector not found|missing connector|does not implement execute|missing execute/.test(combined)) {
    return {
      type: "MISSING_CONNECTOR_OR_PROVIDER",
      severity: "Warning",
      safeAction: "ARCHIVE_OR_BACKLOG",
      retryable: false,
      recommendation: "Move to capability backlog or register the missing provider before retrying."
    };
  }

  if (/approval|awaiting_approval|ceo|authority|not allowed/.test(combined)) {
    return {
      type: "GOVERNANCE_REQUIRED",
      severity: "Info",
      safeAction: "KEEP_FOR_APPROVAL",
      retryable: false,
      recommendation: "Leave blocked until CEO approval or governance rule update."
    };
  }

  if (/timeout|timed out|browser|navigation|selector|page closed|target closed/.test(combined)) {
    return {
      type: "TRANSIENT_BROWSER_OR_TIMEOUT",
      severity: "Warning",
      safeAction: "RETRY_ONCE",
      retryable: true,
      recommendation: "Retry once after browser/session refresh. Escalate if repeated."
    };
  }

  if (/login|credential|auth|unauthorized|forbidden|permission/.test(combined)) {
    return {
      type: "AUTH_OR_PERMISSION",
      severity: "Critical",
      safeAction: "ESCALATE",
      retryable: false,
      recommendation: "Credential or login issue requires human review."
    };
  }

  if (/task not found/.test(combined)) {
    return {
      type: "QUEUE_INTEGRITY",
      severity: "Warning",
      safeAction: "ARCHIVE_OR_BACKLOG",
      retryable: false,
      recommendation: "Archive stale task reference and rebuild queue item if still needed."
    };
  }

  return {
    type: "UNCLASSIFIED_FAILURE",
    severity: "Warning",
    safeAction: "CLASSIFY",
    retryable: false,
    recommendation: "Review failure details and add pattern to Engineering COO classifier."
  };
}

class EngineeringCOOService {
  async runOnce(options = {}) {
    ensureDir();

    const allTasks = taskQueue.list();
    const failed = allTasks.filter(t => t.status === "FAILED");
    const queued = allTasks.filter(t => t.status === "QUEUED");
    const running = allTasks.filter(t => t.status === "RUNNING");
    const completed = allTasks.filter(t => t.status === "COMPLETED");

    const failures = failed.map(task => ({
      taskId: task.id,
      type: task.type,
      provider: task.provider || task.payload?.provider || task.payload?.system || "UNKNOWN",
      capability: task.payload?.capability || null,
      action: task.payload?.action || null,
      error: task.error || task.result?.error || null,
      classification: classifyFailure(task),
      createdAt: task.createdAt || null,
      updatedAt: task.updatedAt || null
    }));

    const summary = this.summarizeFailures(failures);

    const safeRetries = failures.filter(f =>
      f.classification.retryable &&
      f.classification.safeAction === "RETRY_ONCE"
    );

    const archiveCandidates = failures.filter(f =>
      f.classification.safeAction === "ARCHIVE_OR_BACKLOG"
    );

    const escalations = failures.filter(f =>
      f.classification.safeAction === "ESCALATE" ||
      f.classification.type === "GOVERNANCE_REQUIRED"
    );

    const report = {
      ok: true,
      generatedAt: now(),
      mode: options.apply === true ? "APPLY" : "AUDIT",
      queue: {
        total: allTasks.length,
        queued: queued.length,
        running: running.length,
        completed: completed.length,
        failed: failed.length
      },
      failureSummary: summary,
      failures,
      safeRetries,
      archiveCandidates,
      escalations,
      recommendations: this.buildRecommendations(summary, safeRetries, archiveCandidates, escalations),
      actionsTaken: [],
      selfEngineering: {
        enabled: true,
        attempted: 0,
        succeeded: 0,
        failed: 0,
        results: []
      }
    };

    if (options.apply === true) {
      report.actionsTaken = await this.applySafeActions(report);
    }

    fs.writeFileSync(LATEST_REPORT, JSON.stringify(report, null, 2));
    fs.writeFileSync(LATEST_MD, this.toMarkdown(report));

    try {
      eventBus.publish("ENGINEERING_COO_REPORT", report);
    } catch {}

    log("EngineeringCOOService", "Run engineering COO", "Completed", LATEST_REPORT);

    return report;
  }

  summarizeFailures(failures = []) {
    const byType = {};
    const byProvider = {};

    for (const item of failures) {
      const type = item.classification.type || "UNKNOWN";
      const provider = item.provider || "UNKNOWN";

      byType[type] = (byType[type] || 0) + 1;
      byProvider[provider] = (byProvider[provider] || 0) + 1;
    }

    return {
      total: failures.length,
      byType,
      byProvider
    };
  }

  buildRecommendations(summary, safeRetries, archiveCandidates, escalations) {
    const recommendations = [];

    if (summary.total === 0) {
      recommendations.push("No failed tasks detected. Runtime queue is clean.");
      return recommendations;
    }

    if (safeRetries.length > 0) {
      recommendations.push(`Run self-engineering and retry ${safeRetries.length} transient task(s) once after session refresh.`);
    }

    if (archiveCandidates.length > 0) {
      recommendations.push(`Move ${archiveCandidates.length} stale or missing-capability task(s) to backlog/archive instead of repeatedly retrying.`);
    }

    if (escalations.length > 0) {
      recommendations.push(`Escalate ${escalations.length} auth, permission, or governance task(s).`);
    }

    recommendations.push("Use this report to reduce failed-task backlog before adding new COO departments.");

    return recommendations;
  }

  async applySafeActions(report = {}) {
    const actions = [];

    for (const retry of report.safeRetries || []) {
      try {
        const engineeringResult = await SelfEngineeringService.execute({
          runtimeId: retry.taskId,
          service: retry.provider,
          provider: retry.provider,
          capability: retry.capability,
          action: retry.action,
          message: retry.error,
          restartCommand: "node",
          restartArgs: ["StartAutonomousCOO.js"]
        });

        report.selfEngineering.attempted += 1;
        report.selfEngineering.results.push({
          taskId: retry.taskId,
          ok: engineeringResult.ok,
          stage: engineeringResult.stage,
          result: engineeringResult
        });

        if (engineeringResult.ok) {
          report.selfEngineering.succeeded += 1;

          taskQueue.update(retry.taskId, {
            status: "QUEUED",
            engineeringCOO: {
              action: "SELF_ENGINEERING_AND_RETRY_ONCE",
              reason: retry.classification.recommendation,
              selfEngineeringStage: engineeringResult.stage,
              updatedAt: now()
            }
          });

          actions.push({
            ok: true,
            taskId: retry.taskId,
            action: "SELF_ENGINEERING_AND_RETRY_ONCE",
            selfEngineering: engineeringResult
          });
        } else {
          report.selfEngineering.failed += 1;

          actions.push({
            ok: false,
            taskId: retry.taskId,
            action: "SELF_ENGINEERING_FAILED",
            selfEngineering: engineeringResult
          });
        }
      } catch (err) {
        report.selfEngineering.failed += 1;

        actions.push({
          ok: false,
          taskId: retry.taskId,
          action: "SELF_ENGINEERING_AND_RETRY_ONCE",
          error: err.message
        });
      }
    }

    for (const item of report.archiveCandidates || []) {
      try {
        taskQueue.update(item.taskId, {
          status: "ENGINEERING_BACKLOG",
          engineeringCOO: {
            action: "MOVE_TO_ENGINEERING_BACKLOG",
            reason: item.classification.recommendation,
            updatedAt: now()
          }
        });

        actions.push({
          ok: true,
          taskId: item.taskId,
          action: "MOVE_TO_ENGINEERING_BACKLOG"
        });
      } catch (err) {
        actions.push({
          ok: false,
          taskId: item.taskId,
          action: "MOVE_TO_ENGINEERING_BACKLOG",
          error: err.message
        });
      }
    }

    return actions;
  }

  toMarkdown(report = {}) {
    const lines = [];

    lines.push("# Engineering COO Runtime Report");
    lines.push("");
    lines.push(`Generated: ${report.generatedAt}`);
    lines.push(`Mode: ${report.mode}`);
    lines.push("");
    lines.push("## Queue");
    lines.push("");
    lines.push(`- Total: ${report.queue.total}`);
    lines.push(`- Queued: ${report.queue.queued}`);
    lines.push(`- Running: ${report.queue.running}`);
    lines.push(`- Completed: ${report.queue.completed}`);
    lines.push(`- Failed: ${report.queue.failed}`);
    lines.push("");
    lines.push("## Failure Types");
    lines.push("");

    for (const [type, count] of Object.entries(report.failureSummary.byType || {})) {
      lines.push(`- ${type}: ${count}`);
    }

    lines.push("");
    lines.push("## Self Engineering");
    lines.push("");
    lines.push(`- Enabled: ${report.selfEngineering?.enabled === true ? "Yes" : "No"}`);
    lines.push(`- Attempted: ${report.selfEngineering?.attempted || 0}`);
    lines.push(`- Succeeded: ${report.selfEngineering?.succeeded || 0}`);
    lines.push(`- Failed: ${report.selfEngineering?.failed || 0}`);

    lines.push("");
    lines.push("## Recommendations");
    lines.push("");

    for (const rec of report.recommendations || []) {
      lines.push(`- ${rec}`);
    }

    lines.push("");
    lines.push("## Actions Taken");
    lines.push("");

    if (!report.actionsTaken?.length) {
      lines.push("- None");
    } else {
      for (const action of report.actionsTaken) {
        lines.push(`- ${action.action}: ${action.taskId} (${action.ok ? "OK" : "FAILED"})`);
      }
    }

    return lines.join("\n");
  }
}

module.exports = new EngineeringCOOService();