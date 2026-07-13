"use strict";

require("dotenv").config();

process.env.MILES_ROOT =
    process.env.MILES_ROOT ||
    process.cwd();

const Audit =
    require(
        "../SERVICES/RuntimeConsolidationAuditService"
    );

console.log(
    "\n=== BUILD 056 Runtime Consolidation Audit ===\n"
);

const result = Audit.run();

console.log(
    JSON.stringify(result, null, 2)
);

if (!result.ok) {
    process.exit(1);
}

console.log("\nSummary");
console.log(
    "Enterprise Queue:",
    result.enterprise.queue.exists
        ? `${result.enterprise.queue.itemCount} items / ${result.enterprise.queue.sizeMB} MB`
        : "Missing"
);

console.log(
    "Legacy Queue:",
    result.legacy.queue.exists
        ? `${result.legacy.queue.itemCount} items / ${result.legacy.queue.sizeMB} MB`
        : "Missing"
);

console.log(
    "Recommendation:",
    result.comparison.recommendation
);

console.log("\nPASS\n");