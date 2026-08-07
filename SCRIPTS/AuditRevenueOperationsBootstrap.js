"use strict";

const RevenueOperationsBootstrapAuditService =
  require("../SERVICES/revenue/RevenueOperationsBootstrapAuditService");

function parseArguments(argv) {
  return {
    apply: argv.includes("--apply"),
    live: argv.includes("--live")
  };
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArguments(argv);
  const service = new RevenueOperationsBootstrapAuditService();
  const result = await service.audit(args);
  console.log(JSON.stringify(result, null, 2));
  if (!args.apply) {
    console.log("\nPLAN ONLY. Re-run with --apply to persist the revenue bootstrap audit.");
  }
  return result;
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = { parseArguments, main };

