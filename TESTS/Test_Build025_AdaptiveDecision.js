"use strict";

const adjuster =
require("../SERVICES/Learning/ConfidenceAdjuster");

const history =
require("../SERVICES/Learning/DecisionHistory");

console.log("");
console.log("========================================");
console.log(" MILES OS - Build 025");
console.log(" Adaptive Decision");
console.log("========================================");
console.log("");

const result =
adjuster.adjust(
    "MarketingProvider",
    100
);

console.log(result);

history.record(result);

console.log("");
console.log("Decision stored.");
console.log("");

console.log("========================================");
console.log(" Build 025 Complete");
console.log("========================================");