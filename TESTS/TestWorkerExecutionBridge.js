const WorkerExecutionBridge =
require("../SERVICES/WorkerExecutionBridge");

const bridge =
new WorkerExecutionBridge();


const commandQueue =
require("../CORE/CommandQueue");


bridge.register(
"ARCHITECT",
{
    execute(task){

        return {

            message:
            "Architecture task completed",

            task:
            task.title

        };

    }
});


commandQueue.add({

    title:
    "Analyze MILES Architecture",

    type:
    "ARCHITECT",

    priority:
    1

});


console.log(
bridge.executeNext()
);


console.log(
commandQueue.status()
);