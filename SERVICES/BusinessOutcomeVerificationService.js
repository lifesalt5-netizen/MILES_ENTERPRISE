"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const defaultTaskQueue = require("../CORE/TaskQueue");
const BusinessStateDiscoveryEngine =
  require("./BusinessStateDiscoveryEngine");

const ROOT =
  process.env.MILES_ROOT ||
  "C:\\P2GC_Intelligence\\MILES_ENTERPRISE";

const TERMINAL_STATUSES = new Set([
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "AWAITING_APPROVAL",
  "AWAITING_CEO_APPROVAL",
  "BLOCKED"
]);

const FOLLOW_UP_STATES = new Set([
  "UNRESOLVED",
  "UNVERIFIED",
  "EXECUTION_FAILED"
]);

function nowIso() {
  return new Date().toISOString();
}

function normalizeStatus(value) {
  return String(value || "")
    .trim()
    .replace(/-/g, "_")
    .toUpperCase();
}

function safeId(value) {
  return String(value || "UNKNOWN")
    .trim()
    .replace(/[^a-z0-9_-]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
}

function stableHash(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex")
    .slice(0, 16);
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : fallback;
}

function sleepSync(milliseconds) {
  Atomics.wait(
    new Int32Array(new SharedArrayBuffer(4)),
    0,
    0,
    milliseconds
  );
}

function processIsAlive(pid) {
  const value = Number(pid);
  if (!Number.isInteger(value) || value <= 0) return false;
  if (value === process.pid) return true;

  try {
    process.kill(value, 0);
    return true;
  } catch (error) {
    return error && error.code === "EPERM";
  }
}

class BusinessOutcomeVerificationService {
  constructor(options = {}) {
    this.root = path.resolve(options.root || ROOT);
    this.taskQueue = options.taskQueue || defaultTaskQueue;
    this.businessStateEngine =
      options.businessStateEngine ||
      new BusinessStateDiscoveryEngine({
        root: this.root,
        taskQueue: this.taskQueue
      });

    this.dataDir = path.resolve(
      options.dataDir ||
      path.join(this.root, "DATA", "autonomous_work")
    );
    this.ledgerFile = path.resolve(
      options.ledgerFile ||
      path.join(this.dataDir, "business_outcome_ledger.json")
    );
    this.lastGoodFile = path.resolve(
      options.lastGoodFile ||
      path.join(this.dataDir, "business_outcome_ledger.last_good.json")
    );
    this.historyFile = path.resolve(
      options.historyFile ||
      path.join(this.dataDir, "business_outcome_history.jsonl")
    );
    this.lockPath = path.resolve(
      options.lockPath ||
      path.join(this.dataDir, "business_outcome_ledger.lock")
    );

    this.maxFollowUpAttempts = positiveInteger(
      options.maxFollowUpAttempts ||
        process.env.MILES_BUSINESS_OUTCOME_MAX_ATTEMPTS,
      2
    );
    this.lockWaitMs = positiveInteger(
      options.lockWaitMs ||
        process.env.MILES_BUSINESS_OUTCOME_LOCK_WAIT_MS,
      10000
    );
    this.lockLeaseMs = positiveInteger(
      options.lockLeaseMs ||
        process.env.MILES_BUSINESS_OUTCOME_LOCK_LEASE_MS,
      Math.max(30000, this.lockWaitMs * 3)
    );

    this.running = false;
    this.lastState = null;
    this.metrics = {
      cycles: 0,
      cyclesSkipped: 0,
      tasksEvaluated: 0,
      resolved: 0,
      unresolved: 0,
      unverified: 0,
      executionFailed: 0,
      awaitingApproval: 0,
      followUpsCreated: 0,
      followUpsSuppressed: 0,
      escalationsCreated: 0,
      supersededTasksCancelled: 0,
      errors: 0,
      lastCycleAt: null,
      lastCycleDurationMs: null
    };

    fs.mkdirSync(this.dataDir, { recursive: true });
  }

  readLockOwner() {
    try {
      return JSON.parse(
        fs.readFileSync(
          path.join(this.lockPath, "owner.json"),
          "utf8"
        )
      );
    } catch {
      return null;
    }
  }

  removeAbandonedLock() {
    if (!fs.existsSync(this.lockPath)) return false;

    const owner = this.readLockOwner();
    let ageMs = 0;

    try {
      ageMs = Math.max(
        0,
        Date.now() -
          new Date(owner?.acquiredAt || fs.statSync(this.lockPath).mtimeMs)
            .getTime()
      );
    } catch {}

    if (processIsAlive(owner?.pid) || ageMs < this.lockLeaseMs) {
      return false;
    }

    try {
      fs.rmSync(this.lockPath, {
        recursive: true,
        force: true
      });
      return true;
    } catch {
      return false;
    }
  }

  acquireLock() {
    const startedAt = Date.now();
    const token =
      `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    while (Date.now() - startedAt < this.lockWaitMs) {
      try {
        fs.mkdirSync(this.lockPath);
        fs.writeFileSync(
          path.join(this.lockPath, "owner.json"),
          JSON.stringify({
            pid: process.pid,
            token,
            acquiredAt: nowIso()
          }, null, 2),
          "utf8"
        );
        return token;
      } catch (error) {
        if (
          !error ||
          !["EEXIST", "EPERM", "EACCES"].includes(error.code)
        ) {
          throw error;
        }
        this.removeAbandonedLock();
        sleepSync(25);
      }
    }

    return null;
  }

  releaseLock(token) {
    try {
      const owner = this.readLockOwner();
      if (!owner || owner.token !== token) return;
      fs.rmSync(this.lockPath, {
        recursive: true,
        force: true
      });
    } catch {}
  }

  withLedgerLock(callback) {
    const token = this.acquireLock();
    if (!token) {
      throw new Error(
        "Business outcome ledger lock could not be acquired within " +
        `${this.lockWaitMs}ms.`
      );
    }

    try {
      return callback();
    } finally {
      this.releaseLock(token);
    }
  }

  emptyLedger() {
    return {
      version: 1,
      type: "BUSINESS_OUTCOME_LEDGER",
      updatedAt: null,
      records: {}
    };
  }

  readLedger() {
    if (!fs.existsSync(this.ledgerFile)) {
      return this.emptyLedger();
    }

    const raw = fs
      .readFileSync(this.ledgerFile, "utf8")
      .replace(/^\uFEFF/, "")
      .trim();

    if (!raw) {
      throw new Error(
        "Business outcome ledger is empty; refusing to replace evidence."
      );
    }

    const parsed = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      !parsed.records ||
      typeof parsed.records !== "object"
    ) {
      throw new Error(
        "Business outcome ledger does not contain a valid records object."
      );
    }

    return parsed;
  }

  writeLedger(ledger) {
    fs.mkdirSync(path.dirname(this.ledgerFile), {
      recursive: true
    });

    if (fs.existsSync(this.ledgerFile)) {
      fs.copyFileSync(this.ledgerFile, this.lastGoodFile);
    }

    const temporary =
      `${this.ledgerFile}.${process.pid}.${Date.now()}.tmp`;
    const value = {
      ...ledger,
      version: 1,
      type: "BUSINESS_OUTCOME_LEDGER",
      updatedAt: nowIso()
    };

    fs.writeFileSync(
      temporary,
      JSON.stringify(value, null, 2),
      "utf8"
    );

    try {
      this.replaceFileAtomically(
        temporary,
        this.ledgerFile
      );
    } finally {
      try {
        fs.unlinkSync(temporary);
      } catch {}
    }

    return value;
  }

  replaceFileAtomically(temporary, destination) {
    let lastError = null;

    for (let attempt = 1; attempt <= 40; attempt++) {
      try {
        fs.renameSync(temporary, destination);
        return;
      } catch (error) {
        lastError = error;
        if (
          !error ||
          !["EBUSY", "EPERM", "EACCES"].includes(error.code)
        ) {
          throw error;
        }
        sleepSync(50);
      }
    }

    throw new Error(
      "Atomic business outcome ledger replacement failed after retries: " +
      String(lastError?.message || "unknown error")
    );
  }

  appendHistory(record) {
    fs.appendFileSync(
      this.historyFile,
      `${JSON.stringify(record)}\n`,
      "utf8"
    );
  }

  listTasks() {
    const tasks =
      this.taskQueue &&
      typeof this.taskQueue.list === "function"
        ? this.taskQueue.list()
        : [];

    return Array.isArray(tasks) ? tasks : [];
  }

  isBusinessTask(task = {}) {
    const finding = task.payload?.finding;
    return (
      String(task.id || "").startsWith("AUTO_business_") ||
      finding?.source === "BusinessStateDiscoveryEngine" ||
      task.payload?.outcome?.source ===
        "BusinessOutcomeVerificationService"
    );
  }

  isTerminalTask(task = {}) {
    return TERMINAL_STATUSES.has(
      normalizeStatus(task.status)
    );
  }

  taskAttempt(task = {}) {
    return Math.max(
      0,
      Number(task.payload?.outcome?.attempt || 0) || 0
    );
  }

  rootTaskId(task = {}) {
    return (
      task.payload?.outcome?.rootTaskId ||
      task.id ||
      null
    );
  }

  executionEvidence(task = {}) {
    const result = task.result;
    const workforceResult = result?.workforceResult;
    const verification =
      workforceResult?.verification ||
      result?.verification ||
      {};
    const executionResult =
      workforceResult?.result ||
      result;
    const providerResult =
      executionResult?.output?.providerResult ||
      executionResult?.providerResult ||
      null;

    const resultPresent =
      Boolean(result && typeof result === "object");
    const resultOk = result?.ok === true;
    const verificationPresent =
      Boolean(verification && typeof verification === "object");
    const executionVerified =
      verification.verified === true;
    const outputPresent =
      Boolean(
        executionResult?.output ||
        providerResult ||
        executionResult?.outFile
      );

    return {
      resultPresent,
      resultOk,
      verificationPresent,
      executionVerified,
      outputPresent,
      providerEvidencePresent:
        Boolean(providerResult?.evidence),
      verificationStatus:
        verification.status || null,
      resultStatus:
        result?.status || null,
      valid:
        resultPresent &&
        resultOk &&
        verificationPresent &&
        executionVerified &&
        outputPresent
    };
  }

  evaluateTask(task, discovery) {
    const taskStatus = normalizeStatus(task.status);
    const finding = task.payload?.finding || {};
    const findingKey =
      finding.findingKey ||
      task.payload?.outcome?.findingKey ||
      null;
    const domain =
      finding.businessDomain ||
      task.payload?.businessDomain ||
      null;
    const attempt = this.taskAttempt(task);
    const execution = this.executionEvidence(task);

    const currentFindings =
      Array.isArray(discovery?.findings)
        ? discovery.findings
        : [];
    const sameFinding =
      findingKey
        ? currentFindings.find(
            item => item.findingKey === findingKey
          ) || null
        : null;
    const visibilityGap =
      domain
        ? currentFindings.find(
            item =>
              item.businessDomain === domain &&
              item.category === "BUSINESS_VISIBILITY"
          ) || null
        : null;
    const domainCount =
      domain && discovery?.state?.counts
        ? Number(discovery.state.counts[domain] || 0)
        : 0;

    let outcomeState;
    let reason;

    if (
      taskStatus === "AWAITING_APPROVAL" ||
      taskStatus === "AWAITING_CEO_APPROVAL" ||
      taskStatus === "BLOCKED"
    ) {
      outcomeState = "AWAITING_APPROVAL";
      reason =
        task.error ||
        "Governance approval is required before the business outcome can close.";
    } else if (
      taskStatus === "FAILED" ||
      taskStatus === "CANCELLED"
    ) {
      outcomeState = "EXECUTION_FAILED";
      reason =
        task.error ||
        `Task ended with status ${taskStatus}.`;
    } else if (!execution.valid) {
      outcomeState = "UNVERIFIED";
      reason =
        "The task completed without the full execution evidence contract.";
    } else if (!discovery || discovery.ok !== true) {
      outcomeState = "UNVERIFIED";
      reason =
        "Current business state could not be discovered.";
    } else if (!findingKey || !domain) {
      outcomeState = "UNVERIFIED";
      reason =
        "The task does not contain a business finding identity and domain.";
    } else if (sameFinding) {
      outcomeState = "UNRESOLVED";
      reason =
        "The original business finding is still present in current state.";
    } else if (visibilityGap || domainCount <= 0) {
      outcomeState = "UNVERIFIED";
      reason =
        "The original finding is absent, but the business domain is not currently observable.";
    } else {
      outcomeState = "RESOLVED";
      reason =
        "The original finding is absent and the business domain remains observable.";
    }

    return {
      outcomeState,
      reason,
      taskId: task.id,
      rootTaskId: this.rootTaskId(task),
      parentTaskId:
        task.payload?.outcome?.parentTaskId || null,
      attempt,
      taskStatus,
      findingKey,
      businessDomain: domain,
      category: finding.category || null,
      execution,
      currentEvidence: {
        sameFindingPresent: Boolean(sameFinding),
        visibilityGapPresent: Boolean(visibilityGap),
        domainCount,
        discoveryGeneratedAt:
          discovery?.generatedAt || null
      },
      evaluatedAt: nowIso()
    };
  }

  taskExists(tasks, id) {
    return tasks.some(task => task.id === id);
  }

  followUpId(task, attempt) {
    return (
      `OUTCOME_${safeId(this.rootTaskId(task))}_` +
      `ATTEMPT_${attempt}`
    );
  }

  escalationId(task) {
    return `OUTCOME_${safeId(this.rootTaskId(task))}_ESCALATION`;
  }

  buildFollowUpTask(task, outcome) {
    const payload = task.payload || {};
    const attempt = outcome.attempt + 1;
    const id = this.followUpId(task, attempt);
    const finding = payload.finding || {};
    const provider = payload.provider || task.provider || "MILES";
    const action = payload.action || task.action || "BUSINESS_REVIEW";
    const capability =
      payload.capability || "business.outcome.remediation";
    const department =
      payload.department || task.department || "Operations";
    const assignedTo =
      payload.assignedTo || "OperationsExecutiveAdvisor";
    const objective =
      `Close unresolved ${outcome.businessDomain || "business"} outcome ` +
      `(${outcome.findingKey || task.id}), attempt ${attempt}: ` +
      outcome.reason;
    const priority = Math.max(
      1,
      Number(task.priority || payload.priority || 3) - 1
    );
    const fingerprint = stableHash({
      rootTaskId: outcome.rootTaskId,
      findingKey: outcome.findingKey,
      attempt,
      provider,
      action,
      capability
    });

    return {
      id,
      type: "WORKFORCE_STEP",
      status:
        payload.safeToAutoExecute === false ||
        payload.blocked === true
          ? "AWAITING_APPROVAL"
          : "QUEUED",
      priority,
      priorityLabel:
        priority === 1
          ? "CRITICAL"
          : priority === 2
            ? "HIGH"
            : "MEDIUM",
      title: objective,
      source: "BusinessOutcomeVerificationService",
      provider,
      action,
      connector: provider,
      department,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      payload: {
        ...payload,
        provider,
        connector: provider,
        department,
        action,
        capability,
        assignedTo,
        objective,
        expectedOutput:
          `Observable business-state evidence that finding ` +
          `${outcome.findingKey || task.id} is resolved.`,
        verification:
          "Re-run BusinessStateDiscoveryEngine and verify the original " +
          "finding is absent while its business domain remains observable.",
        workPackageId: `OUTCOME_WP_${fingerprint}`,
        autonomous: true,
        safeToAutoExecute:
          payload.safeToAutoExecute !== false &&
          payload.blocked !== true,
        finding,
        autonomousWorkFingerprint:
          `outcome_${fingerprint}`,
        outcome: {
          source: "BusinessOutcomeVerificationService",
          rootTaskId: outcome.rootTaskId,
          parentTaskId: task.id,
          attempt,
          findingKey: outcome.findingKey,
          priorOutcomeState: outcome.outcomeState,
          createdAt: nowIso()
        },
        plan: {
          ok: true,
          intent: "BUSINESS_OUTCOME_REMEDIATION",
          workflow: "EXECUTION_TO_OUTCOME_CLOSURE",
          provider,
          system:
            payload.system ||
            finding.infrastructureId ||
            outcome.businessDomain,
          connector: provider,
          department,
          action,
          objective,
          originalCommand: objective,
          steps: [{
            step: 1,
            capability,
            provider,
            department,
            action,
            taskType: "WORKFORCE_STEP",
            assignedTo,
            status: "QUEUED",
            dependsOn: [],
            expectedOutput:
              `Observable closure evidence for ${outcome.findingKey || task.id}.`,
            verification:
              "Verify the original business-state finding is absent and the domain is observable."
          }]
        }
      }
    };
  }

  buildEscalationTask(task, outcome) {
    const id = this.escalationId(task);
    const finding = task.payload?.finding || {};
    const objective =
      `CEO decision required: ${outcome.businessDomain || "business"} ` +
      `finding ${outcome.findingKey || task.id} remains open after ` +
      `${outcome.attempt} autonomous follow-up attempt(s).`;

    return {
      id,
      type: "BUSINESS_OUTCOME_ESCALATION",
      status: "AWAITING_APPROVAL",
      priority: 1,
      priorityLabel: "CRITICAL",
      title: objective,
      source: "BusinessOutcomeVerificationService",
      provider: "MILES",
      connector: "MILES",
      department: "Executive Operations",
      action: "CEO_OUTCOME_DECISION",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      payload: {
        provider: "MILES",
        connector: "MILES",
        department: "Executive Operations",
        action: "CEO_OUTCOME_DECISION",
        capability: "business.outcome.escalation",
        assignedTo: "Kevin",
        objective,
        expectedOutput:
          "A CEO decision to authorize remediation, accept the risk, or defer the outcome.",
        verification:
          "Record the decision and either resolve the finding or create an approved remediation package.",
        autonomous: true,
        safeToAutoExecute: false,
        blocked: true,
        blockReason:
          "Autonomous outcome attempts are exhausted.",
        finding,
        outcome: {
          source: "BusinessOutcomeVerificationService",
          rootTaskId: outcome.rootTaskId,
          parentTaskId: task.id,
          attempt: outcome.attempt,
          findingKey: outcome.findingKey,
          priorOutcomeState: outcome.outcomeState,
          escalation: true,
          createdAt: nowIso()
        }
      }
    };
  }

  submitTask(task, tasks) {
    if (this.taskExists(tasks, task.id)) {
      this.metrics.followUpsSuppressed += 1;
      return {
        created: false,
        taskId: task.id,
        existing: true
      };
    }

    /*
     * Refresh inside the outcome-ledger lock. Another MILES process may
     * have created the deterministic follow-up after this cycle took its
     * initial queue snapshot.
     */
    const currentTasks = this.listTasks();
    if (this.taskExists(currentTasks, task.id)) {
      this.metrics.followUpsSuppressed += 1;
      tasks.push(
        currentTasks.find(item =>
          item.id === task.id
        )
      );
      return {
        created: false,
        taskId: task.id,
        existing: true
      };
    }

    if (!this.taskQueue || typeof this.taskQueue.add !== "function") {
      throw new Error(
        "TaskQueue does not expose add(); outcome work was not submitted."
      );
    }

    const inserted = this.taskQueue.add(task);
    if (!this.taskExists(tasks, task.id)) {
      tasks.push(inserted || task);
    }
    return {
      created: true,
      taskId: task.id,
      task: inserted || task
    };
  }

  cancelSupersededFollowUps(outcome, tasks) {
    if (
      !this.taskQueue ||
      typeof this.taskQueue.update !== "function"
    ) {
      return [];
    }

    const cancelled = [];

    for (const candidate of tasks) {
      const candidateOutcome = candidate.payload?.outcome;
      const candidateStatus = normalizeStatus(candidate.status);

      if (
        candidateOutcome?.rootTaskId !== outcome.rootTaskId ||
        candidate.id === outcome.taskId ||
        ![
          "QUEUED",
          "PENDING",
          "AUTHORIZED",
          "AWAITING_APPROVAL",
          "AWAITING_CEO_APPROVAL"
        ].includes(candidateStatus) ||
        Number(candidateOutcome.attempt || 0) <= outcome.attempt
      ) {
        continue;
      }

      this.taskQueue.update(candidate.id, {
        status: "CANCELLED",
        error:
          "Superseded because current business state verifies the root outcome is resolved.",
        cancelledBy:
          "BusinessOutcomeVerificationService"
      });
      candidate.status = "CANCELLED";
      cancelled.push(candidate.id);
      this.metrics.supersededTasksCancelled += 1;
    }

    return cancelled;
  }

  incrementOutcomeMetric(outcomeState) {
    const key = {
      RESOLVED: "resolved",
      UNRESOLVED: "unresolved",
      UNVERIFIED: "unverified",
      EXECUTION_FAILED: "executionFailed",
      AWAITING_APPROVAL: "awaitingApproval"
    }[outcomeState];

    if (key) this.metrics[key] += 1;
  }

  runCycle(options = {}) {
    if (this.running) {
      this.metrics.cyclesSkipped += 1;
      return {
        ok: true,
        skipped: true,
        status: "CYCLE_ALREADY_RUNNING",
        generatedAt: nowIso()
      };
    }

    this.running = true;
    const startedAt = Date.now();

    try {
      const tasks = this.listTasks();
      const requestedIds =
        Array.isArray(options.taskIds) && options.taskIds.length
          ? new Set(options.taskIds)
          : null;
      const candidates = tasks.filter(task =>
        this.isBusinessTask(task) &&
        this.isTerminalTask(task) &&
        task.payload?.outcome?.escalation !== true &&
        (!requestedIds || requestedIds.has(task.id))
      );

      if (!candidates.length) {
        const emptyState = {
          ok: true,
          type: "BUSINESS_OUTCOME_VERIFICATION_STATE",
          generatedAt: nowIso(),
          durationMs: Date.now() - startedAt,
          evaluations: [],
          summary: {
            evaluated: 0,
            resolved: 0,
            unresolved: 0,
            unverified: 0,
            executionFailed: 0,
            awaitingApproval: 0,
            followUpsCreated: 0,
            escalationsCreated: 0
          }
        };
        this.lastState = emptyState;
        return emptyState;
      }

      let discovery;
      try {
        discovery = this.businessStateEngine.discover();
      } catch (error) {
        discovery = {
          ok: false,
          generatedAt: nowIso(),
          findings: [],
          state: {
            counts: {}
          },
          error: error.message
        };
      }

      const evaluations = [];

      this.withLedgerLock(() => {
        const ledger = this.readLedger();

        for (const task of candidates) {
          const outcome = this.evaluateTask(task, discovery);
          const previous =
            ledger.records[task.id] || null;
          const evaluationFingerprint =
            stableHash({
              taskId: task.id,
              taskStatus:
                outcome.taskStatus,
              taskUpdatedAt:
                task.updatedAt || null,
              resultCompletedAt:
                task.result?.completedAt ||
                task.result?.workforceResult
                  ?.result?.createdAt ||
                null,
              outcomeState:
                outcome.outcomeState,
              findingKey:
                outcome.findingKey,
              sameFindingPresent:
                outcome.currentEvidence
                  .sameFindingPresent,
              visibilityGapPresent:
                outcome.currentEvidence
                  .visibilityGapPresent,
              domainCount:
                outcome.currentEvidence
                  .domainCount
            });
          const record = {
            ...outcome,
            priorOutcomeState:
              previous?.outcomeState || null,
            evaluationFingerprint,
            changed:
              previous
                ?.evaluationFingerprint !==
              evaluationFingerprint,
            followUpTaskId: null,
            escalationTaskId: null,
            cancelledTaskIds: []
          };

          this.metrics.tasksEvaluated += 1;
          this.incrementOutcomeMetric(outcome.outcomeState);

          if (outcome.outcomeState === "RESOLVED") {
            record.cancelledTaskIds =
              this.cancelSupersededFollowUps(outcome, tasks);
          } else if (
            FOLLOW_UP_STATES.has(outcome.outcomeState)
          ) {
            if (
              outcome.attempt < this.maxFollowUpAttempts
            ) {
              const followUp =
                this.buildFollowUpTask(task, outcome);
              const submission =
                this.submitTask(followUp, tasks);

              record.followUpTaskId =
                followUp.id;
              record.followUpCreated =
                submission.created;

              if (submission.created) {
                this.metrics.followUpsCreated += 1;
              }
            } else {
              const escalation =
                this.buildEscalationTask(task, outcome);
              const submission =
                this.submitTask(escalation, tasks);

              record.escalationTaskId =
                escalation.id;
              record.escalationCreated =
                submission.created;

              if (submission.created) {
                this.metrics.escalationsCreated += 1;
              }
            }
          }

          ledger.records[task.id] = record;
          evaluations.push(record);

          if (
            record.changed ||
            record.followUpCreated === true ||
            record.escalationCreated === true ||
            record.cancelledTaskIds.length > 0
          ) {
            this.appendHistory({
              event:
                "BUSINESS_OUTCOME_EVALUATED",
              ...record
            });
          }
        }

        this.writeLedger(ledger);
      });

      const summary = {
        evaluated: evaluations.length,
        resolved:
          evaluations.filter(item =>
            item.outcomeState === "RESOLVED"
          ).length,
        unresolved:
          evaluations.filter(item =>
            item.outcomeState === "UNRESOLVED"
          ).length,
        unverified:
          evaluations.filter(item =>
            item.outcomeState === "UNVERIFIED"
          ).length,
        executionFailed:
          evaluations.filter(item =>
            item.outcomeState === "EXECUTION_FAILED"
          ).length,
        awaitingApproval:
          evaluations.filter(item =>
            item.outcomeState === "AWAITING_APPROVAL"
          ).length,
        followUpsCreated:
          evaluations.filter(item =>
            item.followUpCreated === true
          ).length,
        escalationsCreated:
          evaluations.filter(item =>
            item.escalationCreated === true
          ).length
      };

      const state = {
        ok: true,
        type: "BUSINESS_OUTCOME_VERIFICATION_STATE",
        generatedAt: nowIso(),
        durationMs: Date.now() - startedAt,
        discovery: {
          ok: discovery?.ok === true,
          generatedAt:
            discovery?.generatedAt || null,
          summary:
            discovery?.summary || null,
          error:
            discovery?.error || null
        },
        evaluations,
        summary
      };

      this.metrics.cycles += 1;
      this.metrics.lastCycleAt =
        state.generatedAt;
      this.metrics.lastCycleDurationMs =
        state.durationMs;
      this.lastState = state;

      return state;
    } catch (error) {
      this.metrics.errors += 1;
      const failed = {
        ok: false,
        type: "BUSINESS_OUTCOME_VERIFICATION_STATE",
        status: "FAILED",
        generatedAt: nowIso(),
        durationMs: Date.now() - startedAt,
        error: error.stack || error.message
      };
      this.lastState = failed;
      return failed;
    } finally {
      this.running = false;
    }
  }

  status() {
    let ledgerSummary = null;

    try {
      const records =
        Object.values(this.readLedger().records || {});
      ledgerSummary = {
        total: records.length,
        resolved:
          records.filter(record =>
            record.outcomeState === "RESOLVED"
          ).length,
        unresolved:
          records.filter(record =>
            record.outcomeState === "UNRESOLVED"
          ).length,
        unverified:
          records.filter(record =>
            record.outcomeState === "UNVERIFIED"
          ).length,
        executionFailed:
          records.filter(record =>
            record.outcomeState === "EXECUTION_FAILED"
          ).length,
        awaitingApproval:
          records.filter(record =>
            record.outcomeState === "AWAITING_APPROVAL"
          ).length
      };
    } catch (error) {
      ledgerSummary = {
        error: error.message
      };
    }

    return {
      ok: true,
      service: "BusinessOutcomeVerificationService",
      running: this.running,
      maxFollowUpAttempts: this.maxFollowUpAttempts,
      ledgerFile: this.ledgerFile,
      ledger: ledgerSummary,
      metrics: {
        ...this.metrics
      },
      lastState: this.lastState
        ? {
            ok: this.lastState.ok,
            generatedAt: this.lastState.generatedAt,
            summary: this.lastState.summary || null,
            error: this.lastState.error || null
          }
        : null
    };
  }
}

const instance =
  new BusinessOutcomeVerificationService();

module.exports = instance;
module.exports.BusinessOutcomeVerificationService =
  BusinessOutcomeVerificationService;
