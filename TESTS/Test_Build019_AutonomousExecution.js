"use strict";

const execution = require("../SERVICES/WorkforceExecutionService");

async function run() {
  console.log("");
  console.log("========================================");
  console.log(" MILES OS - Build 019 Autonomous Execution");
  console.log("========================================");
  console.log("");

  const task = {
    id: "TEST-AUTO-EXEC-001",
    type: "WORKFORCE_STEP",
    payload: {
      workPackageId: "TEST-WP-BUILD019",
      objective: "Review paused Instantly campaigns",
      capability: "marketing.instantly.read",
      provider: "MarketingProvider",
      action: "refresh",
      assignedTo: "MILES",
      department: "Marketing",
      expectedOutput: "Current Instantly campaign status.",
      verification: "Verify campaign metrics were captured."
    }
  };

  const result = await execution.executeAndVerify(task);

  console.log("Overall OK:", result.ok);
  console.log("Status:", result.status);
  console.log("Execution Mode:", result.result.executionMode);
  console.log("Provider:", result.result.provider);
  console.log("Action:", result.result.action);
  console.log("Capability:", result.result.capability);
  console.log("Decision:", result.result.output.decision?.decision);
  console.log("Confidence:", result.result.output.decision?.confidence?.confidenceScore);
  console.log("Approval Required:", result.result.output.executionPlan?.executionMode === "CEO_APPROVAL_REQUIRED");
  console.log("Verification:", result.verification.status);
  console.log("Output File:", result.result.outFile);

  console.log("");
  console.log("========================================");
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});