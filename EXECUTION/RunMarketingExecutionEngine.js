"use strict";

const MarketingExecutionEngine = require("./MarketingExecutionEngine");

async function main() {
  const engine = new MarketingExecutionEngine();
  const result = await engine.run();

  console.log("[MILES ENTERPRISE] Marketing Execution Engine complete");
  console.table(result);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
