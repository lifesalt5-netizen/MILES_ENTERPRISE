"use strict";

const operator = require("../SERVICES/Browser/Workers/InstantlyCampaignOperator");

function hasFlag(name) {
  return process.argv.includes(name);
}

(async () => {
  console.log("\n========================================");
  console.log(" MILES BUILD 027 INSTANTLY COO TEST");
  console.log("========================================\n");

  const result = await operator.run({
    headless: hasFlag("--headless"),
    execute: hasFlag("--execute")
  });

  console.log("\n========================================");
  console.log(" RESULT SUMMARY");
  console.log("========================================\n");

  console.log("OK:", result.ok);
  console.log("Mode:", result.mode);
  console.log("Stage:", result.stage);
  console.log("Campaigns:", result.campaigns?.length || 0);

  console.log("\n--- ACTIONS ---");
  console.log("Planned:", result.actions?.planned?.length || 0);
  console.log("Executed:", result.actions?.executed?.length || 0);
  console.log("Verified:", result.actions?.verified?.length || 0);
  console.log("Failed:", result.actions?.failed?.length || 0);
  console.log("Approvals:", result.actions?.approvals?.length || 0);
  console.log("Ignored:", result.actions?.ignored?.length || 0);

  console.log("\n--- SAMPLE CAMPAIGNS ---");
  console.log(result.campaigns?.slice(0, 5));

  console.log("\n--- SAMPLE PLAN ---");
  console.log(result.actions?.planned?.slice(0, 5));

  console.log("\nFile:", result.file);

  if (result.notes?.length) {
    console.log("\n--- NOTES ---");
    console.log(result.notes);
  }

  if (result.errors?.length) {
    console.log("\n--- ERRORS ---");
    console.log(result.errors);
  }

  console.log("\n========================================");
  console.log(" TEST COMPLETE");
  console.log("========================================\n");
})();
