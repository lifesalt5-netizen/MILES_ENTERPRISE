"use strict";

const Service = require("../SERVICES/revenue/RevenueInstantlyWorkspaceForwardingAuditService");

function parseArguments(argv) {
  const authorization = argv.find(value => value.startsWith("--authorization="));
  return {
    apply: argv.includes("--apply"),
    live: argv.includes("--live"),
    authorization: authorization ? authorization.slice("--authorization=".length) : null
  };
}

async function main() {
  const input = parseArguments(process.argv.slice(2));
  const report = await new Service().audit(input);
  console.log(JSON.stringify(report, null, 2));
  if (!input.apply) console.log("\nPLAN ONLY. Exact Gate 23A authorization is required for live provider reads. No provider or mailbox writes occur.");
}

if (require.main === module) main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
module.exports = { main, parseArguments };
