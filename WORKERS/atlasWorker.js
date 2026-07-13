"use strict";

const atlas = require("../SERVICES/ATLASRuntimeInspector");

function runAtlas() {
    try {

        const report = atlas.inspect();

        console.log(
            `[ATLAS] Runtime inspection complete. Drift: ${report.architecture.drift.length}`
        );

        if (report.architecture.drift.length > 0) {

            console.log("[ATLAS] Drift Details:");

            for (const d of report.architecture.drift) {

                console.log(
                    ` - ${d.severity}: ${d.issue}`
                );

            }
        }

    } catch (err) {

        console.error(
            "[ATLAS] Runtime inspection failed:",
            err.message
        );

    }
}

setInterval(runAtlas, 60000);

runAtlas();