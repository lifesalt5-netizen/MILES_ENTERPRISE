const bridgeClass =
require("../SERVICES/WorkerExecutionBridge");

const bridge =
new bridgeClass();


bridge.register(
"ARCHITECT",
{
    execute(task){

        return {
            worker:"ARCHITECT",
            completed:true,
            task:task.title
        };

    }
});


bridge.register(
"ATLAS",
{
    execute(task){

        return {
            worker:"ATLAS",
            completed:true,
            task:task.title
        };

    }
});


console.log(
bridge.registry.list()
);


console.log(
bridge.executeNext()
);