"use strict";

const ExecutiveDecisionExecutor = require("./ExecutiveDecisionExecutor");

async function main() {
  const result = await new ExecutiveDecisionExecutor().run();

  console.log("[MILES ENTERPRISE] Executive Decision Executor");
  console.table({
    decisionsSeen: result.decisionsSeen,
    actionsTaken: result.actionsTaken
  });

  console.log("Actions:");
  console.table(result.results.map(r => ({
    decisionId: r.decisionId,
    action: r.action,
    status: r.status,
    error: r.error
  })));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
