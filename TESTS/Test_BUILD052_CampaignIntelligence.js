"use strict";

require("dotenv").config();

process.env.MILES_ROOT ||= process.cwd();

const InstantlyLiveIntegrationService =
    require("../SERVICES/InstantlyLiveIntegrationService");

(async () => {

    console.log("\n=== BUILD 052 Campaign Intelligence ===\n");

    const campaigns =
        await InstantlyLiveIntegrationService.run({
            operation: "LIST_CAMPAIGNS"
        });

    const items =
        campaigns.result.result.data.items || [];

    for (const campaign of items) {

        console.log("=================================================");
        console.log(campaign.name);
        console.log("-------------------------------------------------");

        const details =
            await InstantlyLiveIntegrationService.run({

                operation: "GET_CAMPAIGN",

                payload: {
                    campaignId: campaign.id
                }

            });

        console.log(JSON.stringify(
            details.result.result.data,
            null,
            2
        ));

        console.log("");

    }

})();