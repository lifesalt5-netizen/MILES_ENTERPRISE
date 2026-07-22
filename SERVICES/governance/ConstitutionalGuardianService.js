"use strict";

const policyEngine =
  require("./PolicyEngineService");
const approvalGate =
  require("./ApprovalGateService");
const audit =
  require("./GovernanceAuditService");

class ConstitutionalGuardianService {
  guard(task = {}, context = {}) {
    const existing =
      task.governance ||
      task.payload?.governance ||
      {};

    const policy =
      existing.policy?.evaluated
        ? existing.policy
        : policyEngine.evaluate(
            task,
            context
          );

    const approval =
      approvalGate.evaluate(
        task,
        policy
      );

    const allowed =
      policy.decision !== "DENY" &&
      approval.allowed === true;

    const guardian = {
      checked: true,
      allowed,
      status:
        allowed
          ? "AUTHORIZED"
          : approval.status ===
              "AWAITING_APPROVAL"
            ? "AWAITING_APPROVAL"
            : "BLOCKED",
      reason:
        allowed
          ? "Constitutional policy, data access, demo protection, and approval checks passed."
          : approval.reason ||
            policy.reason,
      policy,
      approval,
      checkedAt:
        new Date().toISOString()
    };

    audit.guardianDecision(
      task,
      guardian
    );

    return guardian;
  }

  assert(task = {}, context = {}) {
    const guardian =
      this.guard(
        task,
        context
      );

    if (!guardian.allowed) {
      const error =
        new Error(
          `GOVERNANCE_BLOCK: ${guardian.reason}`
        );

      error.code =
        guardian.status ===
          "AWAITING_APPROVAL"
          ? "GOVERNANCE_APPROVAL_REQUIRED"
          : "GOVERNANCE_DENIED";

      error.governance =
        guardian;

      throw error;
    }

    return guardian;
  }
}

module.exports =
  new ConstitutionalGuardianService();