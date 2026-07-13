"use strict";

const atlas =
require("../../SERVICES/ATLASRuntimeInspector");


module.exports = {

    execute(task) {

        const report =
            atlas.inspect();


        return {

            worker:
            "ATLAS",

            task:
            task.title,

            completed:
            true,

            drift:
            report.architecture.drift.length,

            report

        };

    }

};