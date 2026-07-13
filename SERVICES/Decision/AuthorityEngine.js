"use strict";

class AuthorityEngine {
  evaluate(input = {}) {
    const objective = String(input.objective || "").toLowerCase();
    const action = String(input.action || "").toLowerCase();
    const provider = String(input.provider || "").toLowerCase();

    const blockedPatterns = [
      "delete",
      "remove data",
      "drop table",
      "send proposal",
      "change pricing",
      "sign contract",
      "hire",
      "buy",
      "purchase",
      "dns",
      "publish website"
    ];

    const approvalRequired = blockedPatterns.some(pattern =>
      objective.includes(pattern) || action.includes(pattern)
    );

    return {
      ok: !approvalRequired,
      authority: approvalRequired ? "CEO_APPROVAL_REQUIRED" : "MILES_OPERATIONAL",
      approvalRequired,
      provider,
      reason: approvalRequired
        ? "Action matches CEO approval governance rules."
        : "Action is within MILES operational authority."
    };
  }
}

module.exports = new AuthorityEngine();