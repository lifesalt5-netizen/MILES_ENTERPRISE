"use strict";

const Audit = require("../SERVICES/RuntimeActivationAuditService");

console.log("\n=== BUILD 046 Runtime Activation Audit ===\n");

const result = Audit.audit();

console.log("Root:", result.root);
console.log("Checked:", result.totalChecked);
console.log("Found:", result.found);
console.log("Missing:", result.missing);
console.log("");

for (const row of result.results) {
    console.log(`${row.status} | ${row.group} | ${row.name}`);
}

if (!result.ok) process.exit(1);
if (result.found < 1) process.exit(1);

console.log("\nPASS\n");