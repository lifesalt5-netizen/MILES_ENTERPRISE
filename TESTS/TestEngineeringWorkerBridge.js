const EventBus =
require("../CORE/CANONICAL/EventBus");

const Bridge =
require("../DIGITAL_COO/Engineering/EngineeringWorkerBridge");


const bridge = new Bridge();


EventBus.subscribe(
"worker.task.created",
task => {

    console.log("\nWORKER RECEIVED TASK:");

    console.log(task);

});


const result =
bridge.dispatch({

    title:
    "Build Google Workspace Provider",

    priority:
    "Critical",

    assignedWorker:
    "Infrastructure"

});


console.log("\nDISPATCH RESULT:");

console.log(result);