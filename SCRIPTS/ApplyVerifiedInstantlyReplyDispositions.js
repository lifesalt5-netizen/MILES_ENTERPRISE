"use strict";

const Service = require("../SERVICES/revenue/RevenueVerifiedReplyDispositionApplyService");

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
  const report = await new Service().apply(input);
  console.log(JSON.stringify(report, null, 2));
  if (!input.apply) console.log("\nPLAN ONLY. Gate 23B3 may block four exact email addresses and mark one conditional Interested lead. No reply, send, upload, mailbox change, campaign change, or launch occurs.");
}

if (require.main === module) main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
module.exports = { main, parseArguments };
