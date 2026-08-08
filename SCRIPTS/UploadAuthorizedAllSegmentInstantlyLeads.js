"use strict";

function parseArguments(argv) {
  const authorization = argv.find(value => value.startsWith("--authorization="));
  const maximum = argv.find(value => value.startsWith("--maximum-uploads="));
  return {
    apply: argv.includes("--apply"),
    live: argv.includes("--live"),
    authorization: authorization ? authorization.slice("--authorization=".length) : null,
    maximumUploads: maximum ? Number(maximum.slice("--maximum-uploads=".length)) : 0
  };
}

async function main() {
  const input = parseArguments(process.argv.slice(2));
  if (input.apply && input.live) {
    process.env.MILES_DRY_RUN = "false";
    process.env.MILES_ALLOW_INSTANTLY_MUTATIONS = "true";
  }
  const Service = require("../SERVICES/revenue/RevenueAllSegmentGovernedUploadService");
  const report = await new Service().upload(input);
  console.log(JSON.stringify(report, null, 2));
  if (!input.apply) console.log("\nPLAN ONLY. Exact CEO authorization and a 5,654-lead cap are required. Lead creation only; no email send, campaign change, or launch.");
}

if (require.main === module) main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
module.exports = { main, parseArguments };
