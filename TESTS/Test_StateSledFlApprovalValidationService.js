"use strict";

const fs = require("fs");
const path = require("path");

(async () => {
  const ROOT = process.cwd();
  const required = [
    path.join(ROOT, "CONFIG", "state_sled_fl_approval_validation_rules.json"),
    path.join(ROOT, "SERVICES", "StateSledFlApprovalValidationService.js")
  ];
  for (const file of required) {
    if (!fs.existsSync(file)) throw new Error(`Missing required file: ${file}`);
  }
  const rules = JSON.parse(fs.readFileSync(required[0], "utf8"));
  if (rules.targetState !== "FL") throw new Error("Target state must be FL");
  if (rules.expectedCampaignName !== "STATE SLED - FL") throw new Error("Unexpected campaign name");
  if (rules.safety.executeInstantlyMutations !== false) throw new Error("Instantly mutation safety must remain false");
  if (rules.safety.activateCampaigns !== false) throw new Error("Activation safety must remain false");
  if (rules.safety.autoApprove !== false) throw new Error("Auto approval safety must remain false");
  const service = require("../SERVICES/StateSledFlApprovalValidationService");
  if (!service || typeof service.run !== "function") throw new Error("Service run() missing");
  console.log("STATE_SLED_FL_APPROVAL_VALIDATION_TEST=PASS");
})().catch(err => {
  console.error("STATE_SLED_FL_APPROVAL_VALIDATION_TEST=FAIL");
  console.error(err);
  process.exit(1);
});
