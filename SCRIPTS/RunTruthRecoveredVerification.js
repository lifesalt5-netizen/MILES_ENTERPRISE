"use strict";

const Runner = require("../SERVICES/revenue/TruthRecoveredVerificationRunner");

function parseArguments(argv) {
  const budget = argv.find(value => value.startsWith("--credit-budget="));
  return {
    apply: argv.includes("--apply"),
    creditBudget: budget ? Number(budget.slice("--credit-budget=".length)) : 0
  };
}

async function main() {
  const input = parseArguments(process.argv.slice(2));
  const result = await new Runner().run(input);
  console.log(JSON.stringify(result, null, 2));
  if (result.ok !== true && result.status !== "AWAITING_APPROVAL") process.exitCode = 1;
  if (result.mode === "PLAN_ONLY") {
    console.log("\nPLAN ONLY. No MillionVerifier request, credit use, lead upload, campaign activation, or email send occurs.");
  }
}

if (require.main === module) {
  main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
}

module.exports = { main, parseArguments };
