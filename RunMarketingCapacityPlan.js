"use strict";

const { buildCapacityPlan } = require("./DIGITAL_COO/Marketing/MarketingCapacityPlanner");

const result = buildCapacityPlan();

console.log("");
console.log("=====================================");
console.log("MILES MARKETING CAPACITY PLANNER");
console.log("=====================================");
console.log(JSON.stringify(result, null, 2));
console.log("=====================================");
console.log("");
