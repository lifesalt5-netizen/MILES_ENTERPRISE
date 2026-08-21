"use strict";

const Service = require("../SERVICES/revenue/GovernmentContractorTruthVerificationIntakeService");

function parseArguments(argv) {
  const master = argv.find(value => value.startsWith("--master="));
  const recovery = argv.find(value => value.startsWith("--recovery-detail="));
  return {
    apply: argv.includes("--apply"),
    masterPath: master ? master.slice("--master=".length) : null,
    recoveryDetailPath: recovery ? recovery.slice("--recovery-detail=".length) : null
  };
}

function main() {
  const args = parseArguments(process.argv.slice(2));
  const service = new Service({
    masterPath: args.masterPath || undefined,
    recoveryDetailPath: args.recoveryDetailPath || undefined
  });
  const result = service.build({ apply: args.apply });
  console.log(JSON.stringify(result, null, 2));
  if (result.ok !== true) process.exitCode = 1;
  else if (result.mode === "PLAN_ONLY") {
    console.log("\nPLAN ONLY. Re-run with --apply to prepare recovered truth contacts for verification. No verification call, upload, campaign activation, or email send occurs.");
  }
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(error.stack || error.message); process.exitCode = 1; }
}

module.exports = { main, parseArguments };
