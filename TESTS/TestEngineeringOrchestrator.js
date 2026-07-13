const Queue =
require("../DIGITAL_COO/Engineering/EngineeringProjectQueue");

const Orchestrator =
require("../DIGITAL_COO/Engineering/EngineeringOrchestrator");


const queue = new Queue();


queue.add({

title:"Build Google Workspace Provider",

priority:"Critical"

});


const orchestrator =
new Orchestrator(queue);


console.log(
JSON.stringify(
orchestrator.processNext(),
null,
2
));