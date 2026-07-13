"use strict";

const { importSegments } = require("./DIGITAL_COO/Marketing/SegmentImporter");

const result = importSegments();

console.log("");
console.log("=====================================");
console.log("MILES SEGMENTS IMPORTED TO ENTERPRISE.DB");
console.log("=====================================");
console.log(JSON.stringify(result, null, 2));
console.log("=====================================");
console.log("");
