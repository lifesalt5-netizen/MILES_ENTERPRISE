"use strict";

const WorkerRegistry = require("../SERVICES/WorkerRegistry");
const WorkerSelector = require("../SERVICES/WorkerSelector");

console.log("\n=== BUILD 044 WorkerSelector ===\n");

const mockResolutionEngine = {
    name: "ResolutionEngine",
    execute() {
        return {
            ok: true,
            message: "Mock ResolutionEngine executed"
        };
    }
};

WorkerRegistry.register("ResolutionEngine", mockResolutionEngine);

const result = WorkerSelector.selectByCapability("close_mission");

console.log(JSON.stringify({
    ok: result.ok,
    capability: result.capability,
    selected: result.selected,
    reason: result.reason,
    hasWorker: !!result.worker
}, null, 2));

if (!result.ok) process.exit(1);
if (!result.worker) process.exit(1);
if (result.selected !== "ResolutionEngine") process.exit(1);

const execution = result.worker.execute();

console.log("Execution:", execution);

if (!execution.ok) process.exit(1);

console.log("\nPASS\n");