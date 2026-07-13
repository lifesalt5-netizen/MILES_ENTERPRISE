"use strict";

const { buildSegmentRegistry } = require("./DIGITAL_COO/Marketing/SegmentRegistry");

const registry = buildSegmentRegistry();

console.log("");
console.log("=====================================");
console.log("MILES SEGMENT REGISTRY BUILT");
console.log("=====================================");
console.log(JSON.stringify({
  generatedAt: registry.generatedAt,
  totals: registry.totals,
  topSegments: registry.segments.slice(0, 10).map(s => ({
    name: s.name,
    category: s.category,
    exactRows: s.exactRows,
    sizeMB: s.sizeMB,
    hasEmailColumn: s.hasEmailColumn,
    verified: s.verified,
    readyForUpload: s.readyForUpload,
    nextAction: s.nextAction
  }))
}, null, 2));
console.log("=====================================");
console.log("");