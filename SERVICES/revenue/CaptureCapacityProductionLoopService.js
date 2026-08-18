"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

class CaptureCapacityProductionLoopService {
  constructor(options = {}) {
    this.rootDir = path.resolve(
      options.rootDir || process.env.MILES_ROOT || path.resolve(__dirname, "..", "..")
    );
    this.intervalMs = positiveNumber(options.intervalMs, DEFAULT_INTERVAL_MS);
    this.enableExecution = options.enableExecution !== false;
    this.discovery = options.discovery || null;
    this.execution = options.execution || null;
    this.timer = null;
    this.passRunning = false;
    this.started = false;
    this.passCount = 0;
    this.reportFile = options.reportFile || path.join(
      this.rootDir,
      "DATA",
      "runtime",
      "revenue",
      "capture_capacity",
      "production_lane_latest.json"
    );
    this.log = options.log || (message => console.log(`[CAPTURE CAPACITY] ${message}`));
  }

  getDiscovery() {
    if (this.discovery) return this.discovery;
    this.discovery = require("../Discovery/CaptureCapacityRevenueDiscovery");
    return this.discovery;
  }

  getExecution() {
    if (this.execution) return this.execution;
    this.execution = require("./CaptureCapacityAutonomousExecutionService");
    return this.execution;
  }

  writeReport(report) {
    fs.mkdirSync(path.dirname(this.reportFile), { recursive: true });
    const temporary = `${this.reportFile}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(report, null, 2), "utf8");
    fs.renameSync(temporary, this.reportFile);
    return this.reportFile;
  }

  async runOnce() {
    if (this.passRunning) {
      return {
        ok: true,
        status: "CAPTURE_CAPACITY_PASS_ALREADY_RUNNING",
        skipped: true,
        generatedAt: new Date().toISOString()
      };
    }

    this.passRunning = true;
    this.passCount += 1;

    try {
      const discoveryResult = await this.getDiscovery().discover();
      const work = Array.isArray(discoveryResult?.work) ? discoveryResult.work : [];
      const handoff = work.find(item => item?.capability === "revenue.capture_capacity_handoff") || null;
      const blockingWork = handoff ? null : work[0] || null;

      let executionResult = null;

      if (handoff && this.enableExecution) {
        executionResult = await this.getExecution().execute({
          workItem: handoff,
          capability: handoff.capability
        });
      }

      const status = handoff
        ? this.enableExecution
          ? executionResult?.status || "CAPTURE_CAPACITY_EXECUTION_COMPLETE"
          : "CAPTURE_CAPACITY_EXECUTION_DISABLED"
        : blockingWork?.capability || "CAPTURE_CAPACITY_NO_WORK";

      const report = {
        ok: handoff
          ? this.enableExecution
            ? Boolean(executionResult?.ok)
            : true
          : Boolean(discoveryResult?.ok),
        service: "CAPTURE_CAPACITY_PRODUCTION_LOOP",
        status,
        pass: this.passCount,
        enableExecution: this.enableExecution,
        discovery: {
          ok: Boolean(discoveryResult?.ok),
          sourceCounts: discoveryResult?.feed?.sourceCounts || {},
          nextAction: discoveryResult?.feed?.nextAction || null,
          sourceBootstrapStatus: discoveryResult?.feed?.sourceBootstrap?.status || null,
          signalBridgeStatus: discoveryResult?.feed?.signalBridge?.status || null,
          verifiedOrionSignals: discoveryResult?.feed?.signalBridge?.verifiedSignalCount || 0,
          orionValidationQueue: discoveryResult?.feed?.signalBridge?.validationQueueCount || 0,
          artifact: discoveryResult?.feed?.artifact || null
        },
        work: work.map(item => ({
          id: item.id || null,
          capability: item.capability || null,
          priority: item.priority || null,
          priorityScore: item.priorityScore || null,
          reason: item.reason || null
        })),
        handoff: handoff
          ? {
              id: handoff.id || null,
              capability: handoff.capability,
              priority: handoff.priority || null,
              qualifiedRows: handoff.metadata?.qualifiedRows || 0
            }
          : null,
        blockingWork: blockingWork
          ? {
              id: blockingWork.id || null,
              capability: blockingWork.capability || null,
              priority: blockingWork.priority || null,
              reason: blockingWork.reason || null,
              metadata: blockingWork.metadata || null
            }
          : null,
        execution: executionResult
          ? {
              ok: Boolean(executionResult.ok),
              status: executionResult.status || null,
              campaignKey: executionResult.campaignKey || null,
              campaignId: executionResult.campaignId || null,
              qualifiedCount: executionResult.qualifiedCount || 0,
              policy: executionResult.policy || null,
              campaign: executionResult.campaign || null,
              stateFile: executionResult.stateFile || null
            }
          : null,
        safety: {
          campaignActivationRequested: false,
          autonomousActivationAllowed: false,
          executionControlledByMilesAutonomousExecute: true
        },
        generatedAt: new Date().toISOString()
      };

      report.artifact = this.writeReport(report);
      this.log(`${status}; qualified=${report.handoff?.qualifiedRows || 0}`);
      return report;
    } catch (error) {
      const report = {
        ok: false,
        service: "CAPTURE_CAPACITY_PRODUCTION_LOOP",
        status: "CAPTURE_CAPACITY_PRODUCTION_PASS_FAILED",
        pass: this.passCount,
        enableExecution: this.enableExecution,
        error: error.stack || error.message,
        safety: {
          campaignActivationRequested: false,
          autonomousActivationAllowed: false,
          executionControlledByMilesAutonomousExecute: true
        },
        generatedAt: new Date().toISOString()
      };
      report.artifact = this.writeReport(report);
      this.log(`${report.status}: ${error.message}`);
      return report;
    } finally {
      this.passRunning = false;
    }
  }

  start() {
    if (this.started) {
      return {
        ok: true,
        status: "CAPTURE_CAPACITY_PRODUCTION_LOOP_ALREADY_STARTED",
        intervalMs: this.intervalMs
      };
    }

    this.started = true;

    Promise.resolve()
      .then(() => this.runOnce())
      .catch(error => this.log(`Initial pass failed: ${error.message}`));

    this.timer = setInterval(() => {
      this.runOnce().catch(error => this.log(`Scheduled pass failed: ${error.message}`));
    }, this.intervalMs);

    if (typeof this.timer.unref === "function") this.timer.unref();

    return {
      ok: true,
      status: "CAPTURE_CAPACITY_PRODUCTION_LOOP_STARTED",
      intervalMs: this.intervalMs,
      executionEnabled: this.enableExecution,
      autonomousActivationAllowed: false
    };
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.started = false;
    return {
      ok: true,
      status: "CAPTURE_CAPACITY_PRODUCTION_LOOP_STOPPED"
    };
  }
}

module.exports = CaptureCapacityProductionLoopService;
module.exports.CaptureCapacityProductionLoopService = CaptureCapacityProductionLoopService;
module.exports.positiveNumber = positiveNumber;
