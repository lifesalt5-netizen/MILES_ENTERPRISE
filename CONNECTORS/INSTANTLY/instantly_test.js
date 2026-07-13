const instantly = require("./instantly");

(async () => {

    console.log("=== INSTANTLY HEALTH ===");

    const health = await instantly.healthCheck();

    console.log(health);

    if (!health.ok) {

        process.exit(1);

    }

    console.log("");

    console.log("=== CAMPAIGNS ===");

    const campaigns = await instantly.listCampaigns();

    console.log(campaigns);

})();