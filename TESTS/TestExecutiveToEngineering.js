const EventBus =
require("../CORE/CANONICAL/EventBus");

const Queue =
require("../DIGITAL_COO/Engineering/EngineeringProjectQueue");

const queue = new Queue();

EventBus.subscribe("build.request", event => {

    const project = queue.add({
        title: event.payload.title,
        priority: event.payload.priority,
        requestedBy: event.payload.requestedBy
    });

    console.log("\nEngineering accepted project:");

    console.log(project);

});

EventBus.publish("build.request", {

    title: "Executive Dashboard V2",

    priority: "Critical",

    requestedBy: "Executive COO"

});

console.log("\nQueue Status");

console.log(queue.dashboard());