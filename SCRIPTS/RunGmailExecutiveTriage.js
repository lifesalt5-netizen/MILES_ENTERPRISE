"use strict";

const GmailExecutiveTriageService = require("../SERVICES/revenue/GmailExecutiveTriageService");

async function main() {
  const execute = process.argv.includes("--execute");
  const service = new GmailExecutiveTriageService();
  const result = await service.run({ execute });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 2;
}

main().catch(error => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exit(2);
});
