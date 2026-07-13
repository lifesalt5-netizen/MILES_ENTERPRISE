const Queue =
require("../DIGITAL_COO/Engineering/EngineeringProjectQueue");

const queue = new Queue();

queue.add({
    title: "Executive Dashboard",
    priority: "High"
});

queue.add({
    title: "Instantly Integration",
    priority: "Critical"
});

console.log("\nInitial");
console.log(queue.dashboard());

const project = queue.next();

queue.start(project.id);

console.log("\nStarted");
console.log(queue.dashboard());

queue.complete(project.id);

console.log("\nCompleted");
console.log(queue.dashboard());