"use strict";

const ExecutiveDecisionEngine = require("./ExecutiveDecisionEngine");

function main() {
  const result = new ExecutiveDecisionEngine().evaluate();

  console.log("[MILES ENTERPRISE] Executive Decision Engine");
  console.log("State:");
  console.table(result.state);

  console.log("Decisions:");
  console.table(result.decisions.map(d => ({
    priority: d.priority,
    department: d.department,
    action: d.action,
    requiresKevin: d.requiresKevin,
    auto: d.executeAutomatically,
    reason: d.reason
  })));
}

main();
