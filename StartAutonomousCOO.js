"use strict";

require("dotenv").config();

const supervisor = require("./CORE/Supervisor");
const AutonomousCOOLoopService = require("./SERVICES/AutonomousCOOLoopService");
const CaptureCapacityProductionLoopService = require("./SERVICES/revenue/CaptureCapacityProductionLoopService");

function boolFromEnv(name, fallback) {
    const value = process.env[name];
    if (value === undefined) return fallback;
    return !["0", "false", "no", "off"].includes(String(value).toLowerCase());
}

function intFromEnv(name, fallback) {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

async function main() {

    //
    // IMPORTANT
    // Register connectors inside THIS process.
    //
    console.log("[MILES] Initializing Supervisor...");

    await supervisor.registerConnectors();

    console.log(
        "[MILES] Connectors:",
        require("./CORE/ConnectorManager").list()
    );

    const mode =
        process.argv.includes("--loop")
            ? "loop"
            : "once";

    const execute =
        boolFromEnv(
            "MILES_AUTONOMOUS_EXECUTE",
            true
        );

    const queueWorkflows =
        boolFromEnv(
            "MILES_AUTONOMOUS_QUEUE_WORKFLOWS",
            true
        );

    const maxExecutionPasses =
        intFromEnv(
            "MILES_AUTONOMOUS_EXECUTION_PASSES",
            5
        );

    const intervalMs =
        intFromEnv(
            "MILES_AUTONOMOUS_INTERVAL_MS",
            5 * 60 * 1000
        );

    const loop =
        new AutonomousCOOLoopService({

            enableExecution: execute,

            enableWorkflowQueueing: queueWorkflows,

            maxExecutionPasses,

            intervalMs,

            maxCycles:
                mode === "once"
                    ? 1
                    : null

        });

    const captureCapacity =
        new CaptureCapacityProductionLoopService({
            intervalMs,
            enableExecution: execute
        });

    const stopCaptureCapacity = () => {
        try {
            captureCapacity.stop();
        } catch {}
    };

    process.once("SIGINT", stopCaptureCapacity);
    process.once("SIGTERM", stopCaptureCapacity);

    if (mode === "loop") {

        console.log("[MILES] Autonomous COO loop starting.");
        console.log(`[MILES] Execution: ${execute ? "enabled" : "disabled"}`);
        console.log(`[MILES] Workflow queueing: ${queueWorkflows ? "enabled" : "disabled"}`);
        console.log(`[MILES] Interval: ${intervalMs}ms`);

        const captureCapacityStart = captureCapacity.start();
        console.log(
            `[MILES] Capture Capacity revenue lane: ${captureCapacityStart.status}; ` +
            `execution=${captureCapacityStart.executionEnabled ? "enabled" : "disabled"}; ` +
            "auto-activation=disabled"
        );

        try {
            const result = await loop.start();
            console.log(JSON.stringify(result, null, 2));
        } finally {
            stopCaptureCapacity();
        }

        return;
    }

    console.log("[MILES] Running one autonomous COO cycle.");

    const captureCapacityResult = await captureCapacity.runOnce();
    const result = await loop.runOnce();

    console.log(JSON.stringify({

        ok: result.ok,

        cycleId: result.cycleId,

        autonomy: result.autonomy,

        businessHealth: result.businessHealth,

        healthScore: result.health?.overallScore,

        missionPriorities:
            result.mission?.priorities?.length || 0,

        workCreated:
            result.workCreated?.total || 0,

        workflowsQueued:
            result.workflowResults?.length || 0,

        executionPasses:
            result.executionResults?.length || 0,

        captureCapacityRevenue: {
            ok: captureCapacityResult.ok,
            status: captureCapacityResult.status,
            qualifiedRows: captureCapacityResult.handoff?.qualifiedRows || 0,
            verifiedOrionSignals: captureCapacityResult.discovery?.verifiedOrionSignals || 0,
            orionValidationQueue: captureCapacityResult.discovery?.orionValidationQueue || 0,
            campaignId: captureCapacityResult.execution?.campaignId || null,
            activationAllowed: false,
            artifact: captureCapacityResult.artifact || null
        },

        outputs: {

            executive:
                "DATA/executive/latest_coo_cycle.md",

            mission:
                "DATA/executive/latest_mission_plan.json",

            health:
                "DATA/executive/latest_universal_health.json",

            repair:
                "DATA/autonomous_repair/latest_repair_plan.json",

            backlog:
                "DATA/capability_backlog/latest_capability_backlog.json",

            cycle:
                "DATA/runtime/latest_coo_cycle.json",

            captureCapacity:
                "DATA/runtime/revenue/capture_capacity/production_lane_latest.json"

        }

    }, null, 2));

}

main().catch(err => {

    console.error(
        "[MILES] Autonomous COO failed:",
        err.stack || err.message
    );

    process.exitCode = 1;

});