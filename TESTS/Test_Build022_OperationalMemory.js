"use strict";

const memory = require("../SERVICES/Memory/OperationalMemoryService");

console.log("");
console.log("========================================");
console.log(" MILES OS - Build 022 Operational Memory");
console.log("========================================");
console.log("");

const result = memory.record({
    taskId: "TEST-MEMORY-001",
    workPackageId: "TEST-WP-022",
    objective: "Review paused Instantly campaigns",
    provider: "MarketingProvider",
    capability: "marketing.instantly.read",
    action: "refresh",
    executionMode: "AUTONOMOUS",
    status: "COMPLETED",
    createdAt: new Date().toISOString(),
    output: {
        decision: {
            decision: "PROCEED",
            confidence: {
                confidenceScore: 100
            }
        },
        recommendation:
            "MarketingProvider executed successfully."
    }
});

console.log("Record Result");
console.log(result);

console.log("");

console.log("Statistics");
console.log(memory.statistics());

console.log("");

console.log("Recent Execution");

const recent = memory.recent(1);

console.log(JSON.stringify(recent[0], null, 2));

console.log("");
console.log("========================================");
console.log(" Build 022 Complete");
console.log("========================================");