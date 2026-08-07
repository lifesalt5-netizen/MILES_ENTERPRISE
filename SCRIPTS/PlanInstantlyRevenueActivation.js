"use strict";

const Service = require("../SERVICES/revenue/RevenueInstantlyActivationPlanService");

function parseArguments(argv) { return { apply: argv.includes("--apply") }; }

function main() {
  const result = new Service().build(parseArguments(process.argv.slice(2)));
  console.log(JSON.stringify(result, null, 2));
  if (result.ok !== true) process.exitCode = 1;
  else if (result.mode === "PLAN_ONLY") console.log("\nPLAN ONLY. Re-run with --apply to prepare the Instantly activation plan. No provider writes occur.");
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(error.stack || error.message); process.exitCode = 1; }
}

module.exports = { main, parseArguments };
