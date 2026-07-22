"use strict";

class ApprovalGateService {
  evaluate(task = {}, policy = {}) {
    const payload =
      task.payload ||
      {};

    const approval =
      task.approval ||
      payload.approval ||
      task.governance?.approval ||
      payload.governance?.approval ||
      {};

    if (
      policy.decision === "DENY"
    ) {
      return {
        allowed: false,
        status: "DENIED",
        approvalRequired: false,
        reason: policy.reason
      };
    }

    if (
      !policy.approvalRequired
    ) {
      return {
        allowed: true,
        status: "NOT_REQUIRED",
        approvalRequired: false,
        reason:
          "No approval required."
      };
    }

    const approved =
      approval.approved === true &&
      String(
        approval.approver ||
        ""
      ).toUpperCase() ===
        String(
          policy.approver ||
          "CEO"
        ).toUpperCase();

    return {
      allowed: approved,
      status:
        approved
          ? "APPROVED"
          : "AWAITING_APPROVAL",
      approvalRequired: true,
      approver:
        policy.approver ||
        "CEO",
      approvedBy:
        approved
          ? approval.approver
          : null,
      approvedAt:
        approved
          ? approval.approvedAt ||
            new Date().toISOString()
          : null,
      reason:
        approved
          ? "Required CEO approval verified."
          : policy.reason
    };
  }
}

module.exports =
  new ApprovalGateService();