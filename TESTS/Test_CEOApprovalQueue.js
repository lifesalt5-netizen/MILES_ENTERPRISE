"use strict";

const approvals = require("../SERVICES/Executive/CEOApprovalQueue");

console.log("");
console.log("========================================");
console.log(" MILES COO v1 - CEO Approval Queue Test");
console.log("========================================");
console.log("");

approvals.clearTestItems();

const created = approvals.enqueue({
  id: "TEST-CEO-APPROVAL-001",
  priority: "HIGH",
  category: "Pricing",
  objective: "Approve pricing change",
  reason: "Pricing changes require CEO approval.",
  recommendation: "Review before allowing MILES to proceed.",
  risk: "MEDIUM",
  requestedBy: "MILES",
  provider: "TestProvider",
  capability: "executive.approval.test",
  action: "requestApproval"
});

console.log("Created:", created.ok);
console.log("Pending:", approvals.pending().length);
console.log("Stats:", approvals.statistics());

const approved = approvals.approve("TEST-CEO-APPROVAL-001", "Approved during smoke test.");

console.log("Approved:", approved.ok);
console.log("Pending After:", approvals.pending().length);
console.log("Stats After:", approvals.statistics());

console.log("");
console.log("========================================");
console.log(" CEO Approval Queue Test Complete");
console.log("========================================");