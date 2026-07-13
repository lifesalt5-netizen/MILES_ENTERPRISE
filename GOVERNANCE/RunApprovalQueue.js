"use strict";

const ApprovalQueueEngine = require("./ApprovalQueueEngine");

function main() {
  const engine = new ApprovalQueueEngine();

  console.log("[MILES ENTERPRISE] Approval Queue Status");
  console.log("Pending Summary:");
  console.table(engine.pendingSummary());

  console.log("Approval Stats:");
  console.table(engine.stats());
}

main();
