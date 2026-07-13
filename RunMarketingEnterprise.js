"use strict";

const { runMarketingCOO } = require("./DIGITAL_COO/Marketing/MarketingCOO");

runMarketingCOO()
  .then(result => {
    console.log("");
    console.log("=====================================");
    console.log("MILES ENTERPRISE MARKETING COO");
    console.log("=====================================");
    console.log(JSON.stringify(result, null, 2));
    console.log("=====================================");
  })
  .catch(err => {
    console.error("[MARKETING COO FAILED]", err);
    process.exit(1);
  });
