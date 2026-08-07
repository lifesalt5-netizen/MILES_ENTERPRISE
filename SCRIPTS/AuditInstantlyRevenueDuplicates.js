"use strict";

const Service = require("../SERVICES/revenue/RevenueInstantlyDuplicateAuditService");

function parseArguments(argv) {
  return {
    apply: argv.includes("--apply"),
    live: argv.includes("--live")
  };
}

async function main() {
  const input = parseArguments(process.argv.slice(2));
  const service = new Service();
  const report = await service.audit(input);
  console.log(JSON.stringify(report, null, 2));
  if (!input.apply) {
    console.log("\nPLAN ONLY. Re-run with --apply --live to perform the read-only Instantly duplicate audit.");
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = { main, parseArguments };
