"use strict";

function check(name, loader) {
    try {
        const obj = loader();

        console.log("PASS:", name);

        return {
            name,
            ok: true,
            type: typeof obj,
            constructor: obj?.constructor?.name || null
        };

    } catch (err) {

        console.log("FAIL:", name);
        console.log("      ", err.message);

        return {
            name,
            ok: false,
            error: err.message
        };

    }
}

console.log("\n=== BUILD 047 Runtime Wiring Audit ===\n");

const results = [];

results.push(check(
    "MissionLifecycleService",
    () => require("../SERVICES/MissionLifecycleService")
));

results.push(check(
    "MissionCapabilityResolver",
    () => require("../SERVICES/MissionCapabilityResolver")
));

results.push(check(
    "WorkerSelector",
    () => require("../SERVICES/WorkerSelector")
));

results.push(check(
    "WorkerRegistry",
    () => require("../SERVICES/WorkerRegistry")
));

results.push(check(
    "WorkerExecutionBridge",
    () => require("../SERVICES/WorkerExecutionBridge")
));

results.push(check(
    "InstantlyCOOWorker",
    () => require("../SERVICES/workers/InstantlyCOOWorker")
));

results.push(check(
    "InstantlyProviderController",
    () => require("../SERVICES/InstantlyProviderController")
));

results.push(check(
    "BrowserSessionManager",
    () => require("../SERVICES/Browser/BrowserSessionManager")
));

results.push(check(
    "InstantlyCampaignOperator",
    () => require("../SERVICES/Browser/Workers/InstantlyCampaignOperator")
));

console.log("\n====================================");

const passed = results.filter(r => r.ok).length;
const failed = results.filter(r => !r.ok).length;

console.log("\nLoaded:", passed);
console.log("Failed:", failed);

if (failed === 0) {
    console.log("\nRUNTIME WIRING VERIFIED");
} else {
    console.log("\nRUNTIME HAS BROKEN LINKS");
}

console.log();