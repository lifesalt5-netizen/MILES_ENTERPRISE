"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT =
  process.env.MILES_ROOT ||
  path.resolve(__dirname, "..", "..");

const AUDIT_DIR = path.join(
  ROOT,
  "DATA",
  "governance_audit"
);

function ensureDir() {
  fs.mkdirSync(AUDIT_DIR, {
    recursive: true
  });
}

function safe(value) {
  try {
    return JSON.parse(
      JSON.stringify(value)
    );
  } catch {
    return {
      unserializable: true,
      value: String(value)
    };
  }
}

class GovernanceAuditService {
  record(eventType, details = {}) {
    ensureDir();

    const timestamp =
      new Date().toISOString();

    const record = {
      auditId:
        crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}_${Math.random()
              .toString(16)
              .slice(2)}`,
      eventType,
      timestamp,
      constitutionVersion:
        details.constitutionVersion ||
        details.policy?.constitutionVersion ||
        "1.0.0",
      policyVersion:
        details.policyVersion ||
        details.policy?.policyVersion ||
        "1.0.0",
      taskId:
        details.taskId ||
        details.task?.id ||
        null,
      actor:
        details.actor ||
        details.context?.actor ||
        "MILES",
      role:
        details.role ||
        details.context?.role ||
        "MILES",
      decision:
        details.decision ||
        details.policy?.decision ||
        null,
      reason:
        details.reason ||
        details.policy?.reason ||
        null,
      details:
        safe(details)
    };

    const day =
      timestamp.slice(0, 10);

    const file =
      path.join(
        AUDIT_DIR,
        `governance_${day}.jsonl`
      );

    fs.appendFileSync(
      file,
      `${JSON.stringify(record)}\n`,
      "utf8"
    );

    return record;
  }

  policyDecision(task, policy) {
    return this.record(
      "POLICY_DECISION",
      {
        task,
        policy,
        decision: policy.decision,
        reason: policy.reason
      }
    );
  }

  guardianDecision(task, guardian) {
    return this.record(
      "GUARDIAN_DECISION",
      {
        task,
        guardian,
        decision:
          guardian.allowed
            ? "ALLOW"
            : "DENY",
        reason: guardian.reason
      }
    );
  }

  executionResult(task, result) {
    return this.record(
      "EXECUTION_RESULT",
      {
        taskId: task?.id || null,
        task,
        result,
        decision:
          result?.ok
            ? "EXECUTED"
            : "FAILED",
        reason:
          result?.status ||
          result?.error ||
          null
      }
    );
  }
}

module.exports =
  new GovernanceAuditService();