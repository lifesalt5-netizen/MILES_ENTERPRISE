"use strict";

const trace = [];

function log(step, ok, detail = null) {
    trace.push({ step, ok, detail });
    console.log(`${ok ? "PASS" : "FAIL"}  ${step}`);
    if (detail) console.log("      ", detail);
}

console.log("\n=== BUILD 049 Real Instantly Worker Trace ===\n");

try {
    const WorkerRegistry = require("../SERVICES/WorkerRegistry");
    const WorkerSelector = require("../SERVICES/WorkerSelector");
    const MissionCapabilityResolver = require("../SERVICES/MissionCapabilityResolver");
    const InstantlyCOOWorker = require("../SERVICES/workers/InstantlyCOOWorker");

    log("Core services loaded", true);

    let worker;

    if (typeof InstantlyCOOWorker === "function") {
        worker = new InstantlyCOOWorker();
        log("InstantlyCOOWorker instantiated from class", true);
    } else {
        worker = InstantlyCOOWorker;
        log("InstantlyCOOWorker loaded as instance/object", true);
    }

    WorkerRegistry.register("InstantlyCOOWorker", worker);
    log("InstantlyCOOWorker registered", true);

    const mission = {
        id: "MISSION-049",
        type: "campaign_health_check",
        requiredCapability: "campaign_health_check",
        asset: "Instantly",
        dryRun: true,
        liveWrite: false
    };

    const resolved = MissionCapabilityResolver.resolve(mission);

    log("Mission capability resolved", !!resolved.ok, JSON.stringify(resolved));

    if (!resolved.ok) {
        console.log("\nSTOP: Capability resolver could not resolve this mission.");
        console.log("Add campaign_health_check to capability_registry.json if missing.");
        process.exit(0);
    }

    const selected = WorkerSelector.selectByCapability(resolved.capability);

    log("Worker selected", !!selected.ok, JSON.stringify({
        ok: selected.ok,
        selected: selected.selected,
        reason: selected.reason,
        hasWorker: !!selected.worker
    }));

    if (!selected.ok || !selected.worker) {
        console.log("\nSTOP: WorkerSelector did not return a live worker.");
        console.log("Likely issue: capability_registry.json maps campaign_health_check to a different service name than WorkerRegistry.register().");
        process.exit(0);
    }

    if (typeof selected.worker.execute !== "function") {
        log("Worker has execute()", false, "Missing execute method");
        process.exit(0);
    }

    log("Worker has execute()", true);

    const result = selected.worker.execute(mission);

    log("Worker execute called", true, JSON.stringify(result));

    console.log("\nTrace Summary:");
    for (const row of trace) {
        console.log(`${row.ok ? "✓" : "✗"} ${row.step}`);
    }

    console.log("\nBUILD 049 TRACE COMPLETE\n");

} catch (err) {
    console.error("\nBUILD 049 FAILED");
    console.error(err);
    process.exit(1);
}