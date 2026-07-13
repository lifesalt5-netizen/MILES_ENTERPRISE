"use strict";

require("dotenv").config();

process.env.MILES_ROOT =
    process.env.MILES_ROOT || process.cwd();

const InstantlyLiveIntegrationService =
    require("../SERVICES/InstantlyLiveIntegrationService");

(async () => {

    console.log("\n=== BUILD 051 Live Campaign Discovery ===\n");

    try {

        const result =
            await InstantlyLiveIntegrationService.run({

                operation: "LIST_CAMPAIGNS"

            });

        if (!result.ok) {

            console.log(JSON.stringify(result, null, 2));
            process.exit(1);

        }

        const campaigns =
            result.result.result.data.items || [];

        console.log("Campaign Count:", campaigns.length);

        console.log("");

        campaigns.forEach((campaign, index) => {

            console.log(`${index + 1}. ${campaign.name}`);
            console.log(`   ID: ${campaign.id}`);
            console.log(`   Status: ${campaign.status}`);
            console.log("");

        });

        console.log("PASS");

    } catch (err) {

        console.error(err);
        process.exit(1);

    }

})();