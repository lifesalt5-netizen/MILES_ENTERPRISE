"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ROOT = process.cwd();
const planDir = path.join(ROOT, "DATA", "OUTBOUND", "STATE_SLED", "CAMPAIGN_PLAN");
fs.mkdirSync(planDir, { recursive: true });

const campaignPlan = path.join(planDir, "STATE_SLED_CAMPAIGN_CREATION_UPLOAD_PLAN.csv");
const uploadPlan = path.join(planDir, "STATE_SLED_VERIFIED_LEAD_UPLOAD_PLAN.csv");

if (!fs.existsSync(campaignPlan)) {
  fs.writeFileSync(campaignPlan,
    "state,campaignName,readiness,minimumHealthySenders,maximumDailyPerInbox,sequenceStatus\n" +
    "FL,STATE SLED - FL,READY_FOR_CREATION_APPROVAL,1,25,DRAFT_FOR_APPROVAL\n" +
    "TX,STATE SLED - TX,WAIT_FOR_VERIFIED_CONTACTS,1,25,DRAFT_FOR_APPROVAL\n",
    "utf8"
  );
}

if (!fs.existsSync(uploadPlan)) {
  fs.writeFileSync(uploadPlan,
    "state,email\nFL,contact@example.com\n",
    "utf8"
  );
}

const service = require("../SERVICES/StateSledExecutionPackageService");

(async () => {
  const result = await service.run();
  assert.strictEqual(result.ok, true);
  assert.ok(result.stats.executionPackagesPrepared >= 1);
  assert.ok(result.stats.statesPrepared.includes("FL"));
  assert.strictEqual(result.stats.allMutationsApprovalGated, true);
  assert.strictEqual(result.stats.safety.executeInstantlyMutations, false);
  console.log("STATE_SLED_EXECUTION_PACKAGE_TEST=PASS");
})().catch(error => {
  console.error(error);
  process.exit(1);
});
