"use strict";

class PolicyEngine {
  evaluate(input = {}) {
    const provider = String(input.provider || "");
    const capability = String(input.capability || "");

    const policies = [];

    if (provider === "MarketingProvider" || capability.startsWith("marketing.")) {
      policies.push({
        policy: "Marketing Safety",
        status: "ACTIVE",
        rule: "MILES may review campaign health and recommend action, but unsafe sending changes require approval."
      });
    }

    if (provider === "OrionProvider" || capability.startsWith("orion.")) {
      policies.push({
        policy: "ORION Read Safety",
        status: "ACTIVE",
        rule: "MILES may read ORION data and report health without approval."
      });
    }

    return {
      ok: true,
      policies,
      policyCount: policies.length
    };
  }
}

module.exports = new PolicyEngine();