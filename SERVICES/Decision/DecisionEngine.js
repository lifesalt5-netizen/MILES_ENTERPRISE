"use strict";

const authorityEngine = require("./AuthorityEngine");
const riskEngine = require("./RiskEngine");
const policyEngine = require("./PolicyEngine");
const confidenceEngine = require("./ConfidenceEngine");
const approvalEngine = require("./ApprovalEngine");

class DecisionEngine {
  evaluate(input = {}) {
    const authority = authorityEngine.evaluate(input);
    const risk = riskEngine.evaluate(input);
    const policy = policyEngine.evaluate(input);

    const confidence = confidenceEngine.score({
      ...input,
      authority,
      risk,
      policy
    });

    const approval = approvalEngine.evaluate({
      ...input,
      authority,
      risk,
      policy,
      confidence
    });

    const decision = approval.approvalRequired
      ? "ESCALATE"
      : "PROCEED";

    return {
      ok: decision === "PROCEED",
      type: "MILES_DECISION",
      decision,
      authority,
      risk,
      policy,
      confidence,
      approval,
      createdAt: new Date().toISOString()
    };
  }
}

module.exports = new DecisionEngine();