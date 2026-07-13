"use strict";

/*
==========================================================
 MILES OS
 BUILD_043 Runner
 Autonomous Capability Builder
 Version: 1.0.0
==========================================================
*/

const path = require("path");

process.env.MILES_ROOT = process.env.MILES_ROOT || path.resolve(__dirname, "..");

const builder = require("../SERVICES/capability_builder/AutonomousCapabilityBuilderService");

async function main() {
  const result = builder.run();
  console.log(JSON.stringify(result, null, 2));
}

main().catch(err => {
  console.error("[BUILD_043] FAILED:", err);
  process.exit(1);
});