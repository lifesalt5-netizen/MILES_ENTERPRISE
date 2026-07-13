"use strict";

const fs = require("fs");
const path = require("path");
const ConfigService = require("../SERVICES/ConfigService");

console.log("\n=== BUILD 047.0 Instantly Inventory Check ===\n");

const root = ConfigService.getRoot();

const targets = [
  "SERVICES/workers/InstantlyCOOWorker.js",
  "SERVICES/InstantlyProviderController.js",
  "SERVICES/InstantlyLiveProviderController.js",
  "SERVICES/InstantlyApiClient.js",
  "SERVICES/InstantlyActionBridgeService.js",
  "SERVICES/InstantlyControlledWriteService.js",
  "SERVICES/InstantlyLiveIntegrationService.js",
  "SERVICES/Browser/Workers/InstantlyCampaignOperator.js",
  "SERVICES/Browser/BrowserSessionManager.js",
  "SERVICES/Browser/BrowserSessionEnroller.js",
  "SERVICES/WorkerSelector.js",
  "SERVICES/WorkerRegistry.js",
  "SERVICES/MissionCapabilityResolver.js",
  "SERVICES/MissionLifecycleService.js",
  "SERVICES/ResolutionMemoryService.js",
  "SERVICES/LearningDataService.js"
];

const results = targets.map(file => {
  const full = path.join(root, file);
  return {
    file,
    exists: fs.existsSync(full),
    status: fs.existsSync(full) ? "FOUND" : "MISSING"
  };
});

for (const row of results) {
  console.log(`${row.status} | ${row.file}`);
}

const found = results.filter(r => r.exists).length;
const missing = results.filter(r => !r.exists).length;

console.log("\nSummary:");
console.log("Found:", found);
console.log("Missing:", missing);

if (missing > 0) {
  console.log("\nSome components are missing. Do not build blindly. Inspect missing items first.");
} else {
  console.log("\nAll key Instantly workflow components already exist.");
}

console.log("\nPASS\n");