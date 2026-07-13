"use strict";

const eventBus = require("../SERVICES/Events/EventBus");

console.log("");
console.log("========================================");
console.log(" MILES OS - Build 020 Event Bus Test");
console.log("========================================");
console.log("");

eventBus.subscribe("test.event", event => {
  console.log("Subscriber Received:", event.type);
  console.log("Event ID:", event.id);
});

const event = eventBus.publish(
  "test.event",
  {
    message: "Event Bus online",
    system: "MILES OS"
  },
  {
    source: "Build020Test"
  }
);

console.log("Published:", event.type);
console.log("Created:", event.createdAt);
console.log("");

const recent = eventBus.recent(5);

console.log("Recent Events:", recent.length);
console.log("Status:", eventBus.status().ok);

console.log("");
console.log("========================================");
console.log(" Build 020 Event Bus Test Complete");
console.log("========================================");
console.log("");