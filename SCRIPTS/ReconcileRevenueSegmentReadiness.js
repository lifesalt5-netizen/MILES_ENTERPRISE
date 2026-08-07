"use strict";

const RevenueSegmentReadinessService = require("../SERVICES/revenue/RevenueSegmentReadinessService");

function parseArguments(argv) {
  return { apply: argv.includes("--apply"), live: argv.includes("--live") };
}

async function main() {
  const service = new RevenueSegmentReadinessService();
  const result = await service.reconcile(parseArguments(process.argv.slice(2)));
  console.log(JSON.stringify(result, null, 2));
  if (result.ok !== true) process.exitCode = 1;
  else if (result.mode === "PLAN_ONLY") console.log("\nPLAN ONLY. Re-run with --apply --live to reconcile readiness evidence.");
}

if (require.main === module) main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });

module.exports = { main, parseArguments };
