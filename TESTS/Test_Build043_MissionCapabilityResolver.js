"use strict";

const Resolver =
require("../SERVICES/MissionCapabilityResolver");

console.log("\n=== BUILD 043 ===\n");

const mission = {

    type:"close_mission"

};

const result =
Resolver.resolve(mission);

console.log(
JSON.stringify(result,null,2)
);

if(!result.ok){

    process.exit(1);

}

console.log("\nPASS\n");