"use strict";

const ConfigService = require("../SERVICES/ConfigService");

console.log("\n=== BUILD 042 ConfigService Test ===\n");

const config = ConfigService.describe();

console.log(JSON.stringify(config, null, 2));

if (!config.root.includes("MILES_ENTERPRISE")) {
    console.error("\nFAIL: ConfigService is not pointing to MILES_ENTERPRISE.");
    process.exit(1);
}

console.log("\nPASS");