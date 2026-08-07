"use strict";

const Service = require("../SERVICES/revenue/RevenueVerificationReconciliationService");

function parseArguments(argv) {
  const report = argv.find(value => value.startsWith("--report="));
  return { apply: argv.includes("--apply"), reportPath: report ? report.slice("--report=".length) : null };
}

function main() {
  const result = new Service().reconcile(parseArguments(process.argv.slice(2)));
  console.log(JSON.stringify(result, null, 2));
  if (result.ok !== true) process.exitCode = 1;
  else if (result.mode === "PLAN_ONLY") console.log("\nPLAN ONLY. Re-run with --apply --report=PATH to reconcile the complete MillionVerifier report.");
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(error.stack || error.message); process.exitCode = 1; }
}

module.exports = { main, parseArguments };
