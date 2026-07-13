"use strict";

const Env = require("../SERVICES/ExecutiveEnvironmentService");

console.log("\n=== BUILD 042 Executive Environment ===\n");

const summary = Env.summarize();

console.log(JSON.stringify(summary, null, 2));

if (!summary.ok) process.exit(1);
if (summary.capabilityCount < 1) process.exit(1);
if (summary.assetCount < 1) process.exit(1);

console.log("\nPASS\n");