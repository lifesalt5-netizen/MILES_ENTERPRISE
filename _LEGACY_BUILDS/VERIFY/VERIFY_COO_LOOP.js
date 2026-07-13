"use strict";

/**
 * MILES VERIFY COO LOOP
 * BUILD_036
 * Complete replacement file.
 */

const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT || "D:\\P2GC_Intelligence\\MILES_OS";

const REQUIRED_FILES = [
    "SERVICES\\ContinuousCOOLoopService.js",
    "SERVICES\\QueueRecoveryService.js",
    "SERVICES\\HeartbeatService.js",
    "SERVICES\\RuntimeHealthService.js",
    "SERVICES\\RestartGuardianService.js",
    "SERVICES\\LoopSchedulerService.js",
    "SERVICES\\JsonFileService.js",
    "SERVICES\\TimeUtil.js",
    "BUILDER\\BuilderService.js",
    "RUN_COO_LOOP.ps1",
    "RUN_COO_LOOP_ONCE.ps1",
    "RUN_COO_LOOP_FOREVER.ps1"
];

function exists(relativePath) {
    return fs.existsSync(path.join(ROOT, relativePath));
}

async function run(input = {}) {
    const missing = REQUIRED_FILES.filter(file => !exists(file));
    let loopResult = null;
    let loopError = null;

    if (!missing.length && input.skipRuntime !== true) {
        try {
            loopResult = await require("../SERVICES/ContinuousCOOLoopService").run({
                mode: "ONCE",
                intervalMs: 1000,
                maxItems: 5,
                objective: "BUILD_036 verification cycle."
            });
        } catch (err) {
            loopError = err.stack || err.message || String(err);
        }
    }

    return {
        ok: missing.length === 0 && !loopError,
        action: "VERIFY_COO_LOOP",
        generatedAt: new Date().toISOString(),
        root: ROOT,
        requiredFiles: REQUIRED_FILES.length,
        missing,
        loopResult,
        loopError
    };
}

if (require.main === module) {
    run().then(result => {
        console.log(JSON.stringify(result, null, 2));
        process.exit(result.ok ? 0 : 1);
    }).catch(err => {
        console.error(err.stack || err.message);
        process.exit(1);
    });
}

module.exports = { run };
