"use strict";

const worker = require("../SERVICES/Browser/Workers/InstantlyWorker");

async function run() {
  console.log("");
  console.log("========================================");
  console.log(" MILES Browser Worker - Instantly Test");
  console.log("========================================");
  console.log("");

  const result = await worker.inspectCampaigns({
    headless: true,
    mode: "smoke-test"
  });

  console.log("OK:", result.ok);
  console.log("Status:", result.status);
  console.log("Recommendation:", result.recommendation);
  console.log("CEO Approval Required:", result.ceoApprovalRequired);
  console.log("Result File:", result.resultFile);

  if (result.approvalRequest) {
    console.log("");
    console.log("Approval Item:");
    console.log(result.approvalRequest.id);
    console.log(result.approvalRequest.reason);
  }

  console.log("");
  console.log("Screenshots:");
  (result.screenshots || []).forEach(s => console.log(s));

  console.log("");
  console.log("========================================");
  console.log(" Instantly Worker Test Complete");
  console.log("========================================");
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});