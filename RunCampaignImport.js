"use strict";

const { importCampaigns } = require("./DIGITAL_COO/Marketing/CampaignImporter");

importCampaigns()
  .then(result => {
    console.log("");
    console.log("=====================================");
    console.log("MILES CAMPAIGNS IMPORTED TO ENTERPRISE.DB");
    console.log("=====================================");
    console.log(JSON.stringify(result, null, 2));
    console.log("=====================================");
    console.log("");
  })
  .catch(err => {
    console.error("[CAMPAIGN IMPORT FAILED]", err.message);
    process.exit(1);
  });
