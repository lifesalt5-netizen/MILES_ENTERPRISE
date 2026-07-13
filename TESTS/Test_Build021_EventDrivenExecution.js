"use strict";

const execution = require("../SERVICES/WorkforceExecutionService");
const eventBus = require("../SERVICES/Events/EventBus");

async function run() {
  console.log("");
  console.log("========================================");
  console.log(" MILES OS - Build 021 Event Execution");
  console.log("========================================");
  console.log("");

  const before = eventBus.recent(10).length;

  const task = {
    id: "TEST-EVENT-EXEC-001",
    type: "WORKFORCE_STEP",
    payload: {
      workPackageId: "TEST-WP-BUILD021",
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
  const recent = eventBus.recent(10);

  console.log("Execution OK:", result.ok);
  console.log("Status:", result.status);
  console.log("Events Before:", before);
  console.log("Recent Events:", recent.length);
  console.log("");

  recent.forEach(e => {
    console.log(`${e.type} | ${e.metadata?.taskId || ""}`);
  });

  console.log("");
  console.log("========================================");
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});