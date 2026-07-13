"use strict";

class ApprovalEngine {
  evaluate(input = {}) {
    const approvalRequired =
      Boolean(input.authority?.approvalRequired) ||
      input.risk?.risk === "HIGH" ||
      input.confidence?.confidence === "LOW";

    return {
      ok: !approvalRequired,
      approvalRequired,
      status: approvalRequired ? "AWAITING_CEO_APPROVAL" : "APPROVED_FOR_AUTONOMOUS_EXECUTION",
      reason: approvalRequired
        ? "Decision requires CEO approval due to authority, risk, or confidence."
        : "Decision is approved for autonomous execution."
    };
  }
}

module.exports = new ApprovalEngine();