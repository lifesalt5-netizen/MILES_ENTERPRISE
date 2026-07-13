"use strict";

require("dotenv").config();

process.env.MILES_ROOT =
    process.env.MILES_ROOT || process.cwd();

console.log("ENV LOADED:", !!process.env.INSTANTLY_API_KEY);
console.log("MILES_ROOT:", process.env.MILES_ROOT);

const InstantlyLiveIntegrationService =
    require("../SERVICES/InstantlyLiveIntegrationService");

(async () => {

    console.log("\n=== BUILD 050 Instantly Live Connector ===\n");

    try {

        const result = await InstantlyLiveIntegrationService.run({
            operation: "HEALTH_CHECK"
        });

        console.log(JSON.stringify(result, null, 2));

        console.log("\n=================================\n");

        console.log("Credentials Present:", result.summary.credentialsPresent);
        console.log("Executable:", result.summary.executable);
        console.log("Write Enabled:", result.summary.writeEnabled);
        console.log("Result:", result.summary.resultStatus);

        if (result.summary.credentialsPresent) {
            console.log("\n✓ API Key detected.");
        } else {
            console.log("\n⚠ Missing INSTANTLY_API_KEY");
        }

        console.log("\nPASS\n");

    } catch (err) {

        console.error(err);
        process.exit(1);

    }

})();