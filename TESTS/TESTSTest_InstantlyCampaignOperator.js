"use strict";

const operator = require("../SERVICES/Browser/Workers/InstantlyCampaignOperator");

async function run() {

  console.log("");
  console.log("========================================");
  console.log(" Instantly Campaign Operator TEST");
  console.log("========================================");
  console.log("");

  const result = await operator.run({
    headless: true
  });

  console.log("OK:", result.ok);
  console.log("Stage:", result.stage);
  console.log("Campaigns:", result.campaignsDetected);
  console.log("Paused:", result.pausedCampaigns);
  console.log("Executed:", result.executed);
  console.log("Approvals:", result.approvals.length);
  console.log("Result File:", result.resultFile);

  console.log("");
  console.log("Screenshots:");
  (result.screenshots || []).forEach(s => console.log(s));

  console.log("");
  console.log("========================================");
  console.log(" TEST COMPLETE");
  console.log("========================================");

}

run().catch(err => {
  console.error(err);
  process.exit(1);
});