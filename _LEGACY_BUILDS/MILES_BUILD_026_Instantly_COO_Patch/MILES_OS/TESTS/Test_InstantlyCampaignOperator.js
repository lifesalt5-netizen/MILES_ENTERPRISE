"use strict";

const operator = require("../SERVICES/Browser/Workers/InstantlyCampaignOperator");

(async () => {
  console.log("\n========================================");
  console.log(" MILES BUILD 026 INSTANTLY COO TEST");
  console.log("========================================\n");

  const execute = process.argv.includes("--execute") || process.env.MILES_INSTANTLY_EXECUTE === "1";

  const result = await operator.run({
    headless: false,
    execute
  });

  console.log("\n========================================");
  console.log(" RESULT SUMMARY");
  console.log("========================================\n");

  console.log("OK:", result.ok);
  console.log("Stage:", result.stage);
  console.log("Mode:", result.mode);
  console.log("Campaigns:", result.campaigns?.length || 0);

  console.log("\n--- ACTIONS ---");
  console.log("Planned:", result.actions?.planned?.length || 0);
  console.log("Executed:", result.actions?.executed?.length || 0);
  console.log("Verified:", result.actions?.verified?.length || 0);
  console.log("Failed:", result.actions?.failed?.length || 0);
  console.log("Approvals:", result.actions?.approvals?.length || 0);
  console.log("Ignored:", result.actions?.ignored?.length || 0);

  console.log("\n--- SAMPLE CAMPAIGNS ---");
  console.dir(result.campaigns?.slice(0, 5), { depth: 4 });

  console.log("\n--- SAMPLE PLAN ---");
  console.dir(result.actions?.planned?.slice(0, 5), { depth: 4 });

  if (result.notes?.length) {
    console.log("\n--- NOTES ---");
    console.log(result.notes.join("\n"));
  }

  console.log("\nFile:", result.file);

  if (result.errors?.length) {
    console.log("\n--- ERRORS ---");
    console.log(result.errors);
  }

  console.log("\n========================================");
  console.log(" TEST COMPLETE");
  console.log("========================================\n");
})();
