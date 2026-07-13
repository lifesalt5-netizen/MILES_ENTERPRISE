"use strict";

const trace = [];

function step(name, fn) {
    try {
        const result = fn();

        trace.push({
            step: name,
            ok: true
        });

        return result;

    } catch (err) {

        trace.push({
            step: name,
            ok: false,
            error: err.message
        });

        throw err;
    }
}

console.log("\n=== BUILD 048 End-to-End Mission Trace ===\n");

const MissionLifecycle =
require("../SERVICES/MissionLifecycleService");

const MissionCapabilityResolver =
require("../SERVICES/MissionCapabilityResolver");

const WorkerSelector =
require("../SERVICES/WorkerSelector");

const WorkerRegistry =
require("../SERVICES/WorkerRegistry");

const WorkerExecutionBridge =
require("../SERVICES/WorkerExecutionBridge");

const mockWorker = {

    execute(mission){

        return {

            ok:true,

            worker:"ResolutionEngine",

            mission

        };

    }

};

WorkerRegistry.register(
    "ResolutionEngine",
    mockWorker
);

const mission = {

    id:"MISSION-048",

    type:"close_mission"

};

step("Mission Created",()=>mission);

step("MissionLifecycle Loaded",
()=>MissionLifecycle);

const resolution = step(
    "Capability Resolution",
    ()=>MissionCapabilityResolver.resolve(mission)
);

const selected = step(
    "Worker Selection",
    ()=>WorkerSelector.selectByCapability(
        resolution.capability
    )
);

step(
    "Worker Registry",
    ()=>selected.worker
);

const execution = step(
    "Worker Execute",
    ()=>selected.worker.execute(mission)
);

step(
    "Execution Result",
    ()=>execution
);

console.log();

for(const item of trace){

    console.log(
        `${item.ok ? "PASS":"FAIL"}  ${item.step}`
    );

}

console.log();

console.log(
    JSON.stringify(
        execution,
        null,
        2
    )
);

if(!execution.ok)
    process.exit(1);

console.log("\nMISSION TRACE PASS\n");