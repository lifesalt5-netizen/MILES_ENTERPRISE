"use strict";

const learning = require("../SERVICES/Learning/LearningEngine");

console.log("");
console.log("========================================");
console.log(" MILES OS - Build 024 Learning");
console.log("========================================");
console.log("");

const report = learning.analyze();

console.log("Overall");

console.log(report);

console.log("");

console.log("Providers");

Object.entries(report.providers).forEach(([name,data])=>{

    console.log(
        `${name} -> ${data.completed}/${data.total} (${data.successRate}%)`
    );

});

console.log("");
console.log("========================================");
console.log(" Build 024 Complete");
console.log("========================================");