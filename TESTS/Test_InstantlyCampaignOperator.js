"use strict";

const operator = require("../SERVICES/Browser/Workers/InstantlyCampaignOperator");

(async () => {

  console.log("\n========================================");
  console.log(" MILES V7 AUTONOMOUS CAMPAIGN TEST");
  console.log("========================================\n");

  const result = await operator.run({
    headless: false   // IMPORTANT: you need to SEE it working
  });

  console.log("\n========================================");
  console.log(" RESULT SUMMARY");
  console.log("========================================\n");

  console.log("OK:", result.ok);
  console.log("Stage:", result.stage);
  console.log("Campaigns:", result.campaigns?.length || 0);

  console.log("\n--- ACTIONS ---");
  console.log("Executed:", result.actions?.executed?.length || 0);
  console.log("Verified:", result.actions?.verified?.length || 0);
  console.log("Failed:", result.actions?.failed?.length || 0);
  console.log("Approvals:", result.actions?.approvals?.length || 0);

  console.log("\n--- SAMPLE DATA ---");
  console.log(result.campaigns?.slice(0, 3));

  console.log("\nFile:", result.file);

  if (result.errors?.length) {
    console.log("\n--- ERRORS ---");
    console.log(result.errors);
  }

  console.log("\n========================================");
  console.log(" TEST COMPLETE");
  console.log("========================================\n");

})();