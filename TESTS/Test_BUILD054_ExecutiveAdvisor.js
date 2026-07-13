"use strict";

require("dotenv").config();

process.env.MILES_ROOT =
    process.env.MILES_ROOT || process.cwd();

const Advisor =
require("../SERVICES/InstantlyExecutiveAdvisor");

console.log("\n=== BUILD 054 Executive Advisor ===\n");

const result =
Advisor.run();

console.log("Campaigns:",
    result.totals.campaigns);

console.log("Healthy:",
    result.totals.healthy);

console.log("Needs Review:",
    result.totals.review);

console.log("Queued Work:",
    result.totals.queuedWork);

console.log("");

for(const rec of result.recommendations){

    console.log(
        rec.campaign
    );

    console.log(
        "Priority:",
        rec.priority
    );

    console.log(
        "Summary:",
        rec.summary
    );

    if(rec.actions){

        console.log(
            "Actions:",
            rec.actions.join(", ")
        );

    }

    console.log("");

}

console.log("PASS");