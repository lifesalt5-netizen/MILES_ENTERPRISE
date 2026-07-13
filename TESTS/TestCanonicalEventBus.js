const EventBus = require("../CORE/CANONICAL/EventBus");

EventBus.subscribe("engineering.ready", event => {
    console.log("Engineering Listener:");
    console.log(event);
});

const event = EventBus.publish("engineering.ready", {
    department: "Engineering",
    status: "Healthy"
});

console.log("\nPublished Event:");
console.log(event);