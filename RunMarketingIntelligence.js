"use strict";

const { runMarketingIntelligence } = require("./DIGITAL_COO/Marketing/MarketingIntelligenceEngine");

const result = runMarketingIntelligence();

console.log("");
console.log("=====================================");
console.log("MILES MARKETING INTELLIGENCE ENGINE");
console.log("=====================================");
console.log(JSON.stringify(result, null, 2));
console.log("=====================================");
console.log("");
