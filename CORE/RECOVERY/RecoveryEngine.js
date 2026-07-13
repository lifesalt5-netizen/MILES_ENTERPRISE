const fs = require("fs");
const path = require("path");

const REPORT = path.join(
    process.cwd(),
    "DATA",
    "recovery",
    "recovery_report.json"
);

function classifyFailure(task) {

    const text =
        JSON.stringify(task).toLowerCase();

    if (
        text.includes("api_key") ||
        text.includes("unauthorized")
    )
        return "AUTH_FAILURE";

    if (
        text.includes("config") ||
        text.includes(".env")
    )
        return "CONFIGURATION";

    if (
        text.includes("network") ||
        text.includes("timeout")
    )
        return "NETWORK";

    if (
        text.includes("429") ||
        text.includes("rate")
    )
        return "RATE_LIMIT";

    if (
        text.includes("validation") ||
        text.includes("invalid")
    )
        return "VALIDATION";

    return "UNKNOWN";

}

function classifyFailedTasks(tasks = []) {

    const results = tasks.map(task => {

        const type = classifyFailure(task);

        return {

            task,

            type,

            timestamp:
                new Date().toISOString()

        };

    });

    const report = {

        generated:

            new Date().toISOString(),

        total: results.length,

        items: results

    };

    fs.writeFileSync(
        REPORT,
        JSON.stringify(report, null, 2)
    );

    return report;

}

module.exports = {

    classifyFailure,

    classifyFailedTasks

};