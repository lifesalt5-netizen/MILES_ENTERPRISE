"use strict";

const decisionEngine = require("../SERVICES/Decision/DecisionEngine");

const result = decisionEngine.evaluate({
  objective: "Review paused Instantly campaigns",
  provider: "MarketingProvider",
  action: "refresh",
  capability: "marketing.instantly.read",
  providerResult: { ok: true },
  exceptions: [],
  recommendations: ["Review paused campaigns."]
});

console.log("");
console.log("========================================");
console.log(" MILES OS - Build 018 Decision Test");
console.log("========================================");
console.log("");
console.log("Decision:", result.decision);
console.log("Authority:", result.authority.authority);
console.log("Risk:", result.risk.risk);
console.log("Confidence:", result.confidence.confidenceScore, result.confidence.confidence);
console.log("Approval Required:", result.approval.approvalRequired);
console.log("");
console.log("========================================");