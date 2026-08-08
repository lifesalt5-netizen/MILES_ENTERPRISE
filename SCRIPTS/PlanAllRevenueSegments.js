"use strict";

function parseArguments(argv) {
  return { apply: argv.includes("--apply"), live: argv.includes("--live") };
}

async function main() {
  const input = parseArguments(process.argv.slice(2));
  const Service = require("../SERVICES/revenue/RevenueAllSegmentConfigurationPlanService");
  const report = await new Service().build(input);
  console.log(JSON.stringify(report, null, 2));
  if (!input.apply) console.log("\nPLAN ONLY. Re-run with --apply --live for a read-only Instantly campaign and sender inventory.");
}

if (require.main === module) main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
module.exports = { main, parseArguments };
