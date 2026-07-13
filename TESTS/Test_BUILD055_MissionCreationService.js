"use strict";

require("dotenv").config();

process.env.MILES_ROOT =
    process.env.MILES_ROOT || process.cwd();

const MissionCreationService =
    require("../SERVICES/MissionCreationService");

console.log("\n=== BUILD 055 Mission Creation ===\n");

const result =
MissionCreationService.create({

    worker:
        "InstantlyCOOWorker",

    type:
        "CONFIGURE_CAMPAIGN",

    priority:
        1,

    targetId:
        "campaign_001",

    targetName:
        "HubZone",

    reason:
        "Campaign has no sending accounts."

});

console.log(
    JSON.stringify(
        result,
        null,
        2
    )
);

console.log("");

console.log(
    "Active Missions:",
    MissionCreationService
        .listActive()
        .length
);

console.log("\nPASS\n");