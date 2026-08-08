"use strict";

const Service = require("../SERVICES/revenue/RevenueAllSegmentUploadPreparationService");

function parseArguments(argv) { return { apply: argv.includes("--apply") }; }

async function main() {
  const input = parseArguments(process.argv.slice(2));
  const report = new Service().prepare(input);
  console.log(JSON.stringify(report, null, 2));
  if (!input.apply) console.log("\nPLAN ONLY. Re-run with --apply to prepare the 5,654-lead governed upload package. No provider read, upload, send, campaign change, or launch occurs.");
}

if (require.main === module) Promise.resolve(main()).catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
module.exports = { main, parseArguments };
