"use strict";

const { runAssignmentEngine } = require("./DIGITAL_COO/Marketing/MarketingAssignmentEngine");

const result = runAssignmentEngine();

console.log("");
console.log("=====================================");
console.log("MILES MARKETING ASSIGNMENT ENGINE");
console.log("=====================================");
console.log(JSON.stringify(result, null, 2));
console.log("=====================================");
console.log("");
