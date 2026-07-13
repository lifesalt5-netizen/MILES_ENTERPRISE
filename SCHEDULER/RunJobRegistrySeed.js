"use strict";

const EnterpriseJobRegistry = require("./EnterpriseJobRegistry");

function main() {
  const registry = new EnterpriseJobRegistry();

  registry.register({
    department: "Marketing",
    jobName: "marketing_approval_status",
    priority: 10,
    schedule: "EVERY_5_MINUTES",
    retryPolicy: { retries: 1 },
    dependencies: [],
    payload: { description: "Checks pending Marketing approvals." }
  });

  registry.register({
    department: "Marketing",
    jobName: "marketing_execute_ready_uploads",
    priority: 20,
    schedule: "EVERY_5_MINUTES",
    retryPolicy: { retries: 2 },
    dependencies: ["marketing_approval_status"],
    payload: { description: "Executes approved Marketing upload queue items." }
  });

  console.log("[MILES ENTERPRISE] Enterprise Job Registry");
  console.table(registry.list());
}

main();
