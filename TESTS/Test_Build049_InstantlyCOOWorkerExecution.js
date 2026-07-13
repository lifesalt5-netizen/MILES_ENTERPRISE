"use strict";

const InstantlyCOOWorker = require("../SERVICES/workers/InstantlyCOOWorker");

console.log("\n=== BUILD 049 Live Instantly COO Worker ===\n");

(async () => {

    let worker;

    if (typeof InstantlyCOOWorker === "function") {
        worker = new InstantlyCOOWorker();
    } else {
        worker = InstantlyCOOWorker;
    }

    console.log("Worker:", worker.workerName);
    console.log("Service:", worker.service);
    console.log("Version:", worker.version);

    console.log("\nSupported Actions:");

    worker.supportedActions.forEach(a => {
        console.log(" -", a);
    });

    console.log("\nRunning INSTANTLY_HEALTH_CHECK...\n");

    const result = await worker.execute({

        action: "INSTANTLY_HEALTH_CHECK",

        payload: {},

        metadata: {
            source: "BUILD_049"
        }

    });

    console.log(JSON.stringify(result, null, 2));

    if (!result.ok) {

        console.log("\nWorker executed but returned a non-success status.");
        process.exit(1);

    }

    console.log("\nPASS\n");

})();