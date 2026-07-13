const bootstrapWorkers =
require("../SERVICES/WorkerBootstrap");


const WorkerExecutionBridge =
require("../SERVICES/WorkerExecutionBridge");


bootstrapWorkers();


const bridge =
new WorkerExecutionBridge();


const result =
bridge.executeNext();


console.log(
JSON.stringify(
result,
null,
2
));