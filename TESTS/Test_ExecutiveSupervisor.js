"use strict";

const supervisor =
require("../SERVICES/Supervisor/ExecutiveSupervisor");

(async()=>{

console.log("");

console.log("===================================");

console.log(" Executive Supervisor Test");

console.log("===================================");

const result =
await supervisor.collectWork();

console.log("");

console.log("Discovered:",result.discovered);

result.work.forEach((w,i)=>{

console.log(`${i+1}. ${w.priorityScore} ${w.objective}`);

});

console.log("");

console.log("===================================");

})();