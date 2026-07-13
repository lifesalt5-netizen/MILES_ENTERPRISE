"use strict";

const { runMarketingCOO } = require("./SERVICES/digital_coo/MarketingCOOService");

runMarketingCOO()
  .then(result => {
    console.log("");
    console.log("=====================================");
    console.log("MILES MARKETING COO BRIEF");
    console.log("=====================================");
    console.log(JSON.stringify(result, null, 2));
    console.log("=====================================");
    console.log("");
  })
  .catch(err => {
    console.error("[MARKETING COO FAILED]", err.message);
    process.exit(1);
  });
