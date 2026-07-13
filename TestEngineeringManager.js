const manager = require("./CORE/ENGINEERING/EngineeringManager");

console.log("");
console.log("===== ENGINEERING MANAGER =====");
console.log("");

manager.initializeBaseline();

console.log(manager.status());

console.log("");
console.log("===== PROJECT BACKLOG =====");
console.log("");

console.log(
    JSON.stringify(
        manager.backlog(),
        null,
        2
    )
);