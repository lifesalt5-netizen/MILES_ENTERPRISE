"use strict";

const dispatcher =
require("../SERVICES/ExecutiveDispatcher");

const bootstrapWorkers =
require("../SERVICES/WorkerBootstrap");

const WorkerExecutionBridge =
require("../SERVICES/WorkerExecutionBridge");


bootstrapWorkers();


const mission =
dispatcher.acceptMission({

    title:
    "Build Autonomous Google Workspace Provider",

    objective:
    "Create Google Workspace provisioning capability for MILES",

    priority:
    1,

    authority:
    "ENGINEERING_AUTOMATIC"

});


console.log(
"MISSION CREATED"
);

console.log(
mission.id
);


const bridge =
new WorkerExecutionBridge();


let result;


do {

    result =
    bridge.executeNext();

    console.log(result.status);


}
while(result.status === "COMPLETED");


console.log(
"ENGINEERING RUN COMPLETE"
);