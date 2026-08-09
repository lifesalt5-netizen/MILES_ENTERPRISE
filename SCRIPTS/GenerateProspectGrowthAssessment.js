"use strict";

const ProspectGrowthAssessmentService = require("../SERVICES/revenue/ProspectGrowthAssessmentService");

function parseArgs(argv) {
    const args = argv.slice(2);
    const termIndex = args.findIndex((value) => value === "--term" || value === "--company" || value === "--uei");

    if (termIndex >= 0) {
        return args[termIndex + 1] || "";
    }

    return args[0] || "";
}

function main() {
    const term = parseArgs(process.argv);
    const service = new ProspectGrowthAssessmentService();
    const result = service.build(term);

    console.log(JSON.stringify(result, null, 2));

    if (!result.ok) {
        process.exitCode = 1;
    }
}

main();
