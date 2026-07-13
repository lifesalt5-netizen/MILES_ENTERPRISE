"use strict";

require("dotenv").config();

process.env.MILES_ROOT =
    process.env.MILES_ROOT || process.cwd();

const Inventory =
    require("../SERVICES/InstantlyCampaignInventoryService");

(async () => {

    console.log("\n=== BUILD 053 Campaign Inventory ===\n");

    const result =
        await Inventory.buildInventory();

    console.log("Campaign Count:", result.campaignCount);
    console.log("");

    for (const campaign of result.inventory) {
        console.log(`${campaign.name}`);
        console.log(`  Status: ${campaign.status}`);
        console.log(`  Sending Accounts: ${campaign.sendingAccounts}`);
        console.log(`  Sequence Steps: ${campaign.sequenceSteps}`);
        console.log(`  Subject Variants: ${campaign.subjectVariants}`);
        console.log(`  Health: ${campaign.health}`);
        console.log(`  Issues: ${campaign.issues.join(", ") || "None"}`);
        console.log("");
    }

    console.log("Saved:");
    console.log("DATA\\instantly\\campaign_inventory.json");

    console.log("\nPASS\n");

})();