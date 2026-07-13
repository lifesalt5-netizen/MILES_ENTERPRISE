"use strict";

const discovery = require("../SERVICES/Discovery/DiscoveryEngine");

async function run() {
  console.log("");
  console.log("========================================");
  console.log(" MILES OS - Mission Pack 1 Discovery");
  console.log("========================================");
  console.log("");

  const result = await discovery.discoverAll();

  console.log("Discovery OK:", result.ok);
  console.log("Discovered Work:", result.discoveredCount);
  console.log("");

  result.work.forEach((item, index) => {
    console.log(`${index + 1}. ${item.objective}`);
    console.log(`   Priority: ${item.priority}`);
    console.log(`   Provider: ${item.provider}`);
    console.log(`   Reason: ${item.reason}`);
    console.log("");
  });

  console.log("Discovery Status:");
  console.log(discovery.status());

  console.log("");
  console.log("========================================");
  console.log(" Mission Pack 1 Discovery Complete");
  console.log("========================================");
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});