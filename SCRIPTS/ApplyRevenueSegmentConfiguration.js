"use strict";

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
  if (input.apply && input.live) {
    process.env.MILES_DRY_RUN = "false";
    process.env.MILES_ALLOW_INSTANTLY_MUTATIONS = "true";
  }
  const Service = require("../SERVICES/revenue/RevenueSegmentConfigurationApplyService");
  const report = await new Service().apply(input);
  console.log(JSON.stringify(report, null, 2));
  if (!input.apply) console.log("\nPLAN ONLY. Exact CEO authorization is required for campaign and inbox changes.");
}

if (require.main === module) main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
module.exports = { main, parseArguments };
