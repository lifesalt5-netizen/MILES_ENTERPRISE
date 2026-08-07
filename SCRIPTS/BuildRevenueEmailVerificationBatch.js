"use strict";

const Service = require("../SERVICES/revenue/RevenueEmailVerificationBatchService");

function parseArguments(argv) {
  const creditArgument = argv.find(value => value.startsWith("--credit-limit="));
  return {
    apply: argv.includes("--apply"),
    creditLimit: creditArgument ? Number(creditArgument.split("=")[1]) : 0
  };
}

function main() {
  const result = new Service().build(parseArguments(process.argv.slice(2)));
  console.log(JSON.stringify(result, null, 2));
  if (result.ok !== true) process.exitCode = 1;
  else if (result.mode === "PLAN_ONLY") {
    console.log("\nPLAN ONLY. Re-run with --apply --credit-limit=N to prepare a verification upload batch. No verification call or credit spend occurs.");
  }
}

if (require.main === module) {
  try { main(); }
  catch (error) { console.error(error.stack || error.message); process.exitCode = 1; }
}

module.exports = { main, parseArguments };
