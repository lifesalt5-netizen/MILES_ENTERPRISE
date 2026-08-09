"use strict";

const ProspectDemoPresentationService = require("../SERVICES/revenue/ProspectDemoPresentationService");

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const term = readArg("--uei") || readArg("--company") || process.argv[2];
const jsonMode = process.argv.includes("--json");

const service = new ProspectDemoPresentationService();
const result = service.build(term);

if (jsonMode || !result.ok) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(result.markdown);
  console.log("\nDEMO_PRESENTATION_STATUS=" + result.status);
}

if (!result.ok) process.exitCode = 1;
