"use strict";

const path = require("path");
const fs = require("fs");

const ROOT = process.env.MILES_ROOT || "D:\\P2GC_Intelligence\\MILES_OS";
process.env.MILES_ROOT = ROOT;

const instantly = require(path.join(ROOT, "SERVICES", "Browser", "Workers", "InstantlyCampaignOperator.js"));

function hasArg(name) {
  return process.argv.some(a => String(a).toLowerCase() === String(name).toLowerCase());
}

function count(result, key) {
  return Array.isArray(result?.actions?.[key]) ? result.actions[key].length : 0;
}

function printSummary(result) {
  console.log("");
  console.log("========================================");
  console.log(" MILES BUILD 030 MINIMUM AUTONOMOUS COO");
  console.log("========================================");
  console.log("");
  console.log("OK:", result.ok);
  console.log("Stage:", result.stage);
  console.log("Mode:", result.mode || "UNKNOWN");
  console.log("Campaigns:", Array.isArray(result.campaigns) ? result.campaigns.length : 0);
  console.log("");
  console.log("--- ACTIONS ---");
  console.log("Executed:", count(result, "executed"));
  console.log("Verified:", count(result, "verified"));
  console.log("Failed:", count(result, "failed"));
  console.log("Approvals:", count(result, "approvals"));
  console.log("Ignored:", count(result, "ignored"));
  console.log("");
  console.log("--- SAMPLE CAMPAIGNS ---");
  console.log(JSON.stringify((result.campaigns || []).slice(0, 8), null, 2));
  console.log("");
  console.log("File:", result.file || "NO_FILE");

  if (result.errors && result.errors.length) {
    console.log("");
    console.log("--- ERRORS ---");
    console.log(JSON.stringify(result.errors, null, 2));
  }

  console.log("");
  console.log("========================================");
  console.log(" BUILD 030 TEST COMPLETE");
  console.log("========================================");
}

(async () => {
  const execute = hasArg("--execute");
  const headed = hasArg("--headed");

  const result = await instantly.run({
    execute,
    headless: !headed
  });

  printSummary(result);

  process.exit(result.ok ? 0 : 1);
})();
