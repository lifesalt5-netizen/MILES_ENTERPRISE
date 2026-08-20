"use strict";

require("dotenv").config();

const supervisor = require("./CORE/Supervisor");
const AutonomousCOOLoopService = require("./SERVICES/AutonomousCOOLoopService");
const CaptureCapacityProductionLoopService = require("./SERVICES/revenue/CaptureCapacityProductionLoopService");
const WinBackProductionLoopService = require("./SERVICES/revenue/WinBackProductionLoopService");
const ReplyIntelligenceProductionLoopService = require("./SERVICES/revenue/ReplyIntelligenceProductionLoopService");

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
    console.log("[MILES] Initializing Supervisor...");
    await supervisor.registerConnectors();

    console.log(
        "[MILES] Connectors:",
        require("./CORE/ConnectorManager").list()
    );

    const mode = process.argv.includes("--loop") ? "loop" : "once";
    const execute = boolFromEnv("MILES_AUTONOMOUS_EXECUTE", true);
    const queueWorkflows = boolFromEnv("MILES_AUTONOMOUS_QUEUE_WORKFLOWS", true);
    const maxExecutionPasses = intFromEnv("MILES_AUTONOMOUS_EXECUTION_PASSES", 5);
    const intervalMs = intFromEnv("MILES_AUTONOMOUS_INTERVAL_MS", 5 * 60 * 1000);
    const winBackIntervalMs = intFromEnv("P2GC_WINBACK_DISCOVERY_INTERVAL_MS", 6 * 60 * 60 * 1000);
    const replyIntervalMs = intFromEnv("P2GC_REPLY_INTELLIGENCE_INTERVAL_MS", 5 * 60 * 1000);

    // TaskQueue execution belongs exclusively to miles-worker / StartProductionSystem.js.
    // The COO remains autonomous by planning and queueing work, while the worker claims
    // and executes queued tasks. This prevents two PM2 processes from competing for the
    // same TaskQueue lock.
    const cooQueueExecution = false;

    const loop = new AutonomousCOOLoopService({
        enableExecution: cooQueueExecution,
        enableWorkflowQueueing: queueWorkflows,
        maxExecutionPasses,
        intervalMs,
        maxCycles: mode === "once" ? 1 : null
    });

    const captureCapacity = new CaptureCapacityProductionLoopService({
        intervalMs,
        enableExecution: execute
    });

    const winBack = new WinBackProductionLoopService({
        intervalMs: winBackIntervalMs
    });

    const replyIntelligence = new ReplyIntelligenceProductionLoopService({
        intervalMs: replyIntervalMs
    });

    const stopRevenueSidecars = () => {
        try { captureCapacity.stop(); } catch {}
        try { winBack.stop(); } catch {}
        try { replyIntelligence.stop(); } catch {}
    };

    process.once("SIGINT", stopRevenueSidecars);
    process.once("SIGTERM", stopRevenueSidecars);

    if (mode === "loop") {
        console.log("[MILES] Autonomous COO loop starting.");
        console.log("[MILES] TaskQueue execution: delegated to miles-worker");
        console.log(`[MILES] Revenue sidecar execution: ${execute ? "enabled" : "disabled"}`);
        console.log(`[MILES] Workflow queueing: ${queueWorkflows ? "enabled" : "disabled"}`);
        console.log(`[MILES] Interval: ${intervalMs}ms`);

        const captureCapacityStart = captureCapacity.start();
        console.log(
            `[MILES] Capture Capacity revenue lane: ${captureCapacityStart.status}; ` +
            `execution=${captureCapacityStart.executionEnabled ? "enabled" : "disabled"}; ` +
            "auto-activation=disabled"
        );

        const winBackStart = winBack.start();
        console.log(
            `[MILES] Win-Back recovery lane: ${winBackStart.status}; ` +
            `interval=${winBackIntervalMs}ms; ` +
            "Instantly-mutation=disabled; auto-activation=disabled"
        );

        const replyStart = replyIntelligence.start();
        console.log(
            `[MILES] Reply Intelligence lane: ${replyStart.status}; ` +
            `interval=${replyIntervalMs}ms; ` +
            "Instantly-read-only; prospect-facing-auto-replies=disabled"
        );

        try {
            const result = await loop.start();
            console.log(JSON.stringify(result, null, 2));
        } finally {
            stopRevenueSidecars();
        }
        return;
    }

    console.log("[MILES] Running one autonomous COO cycle.");

    const captureCapacityResult = await captureCapacity.runOnce();
    const winBackResult = await winBack.runOnce();
    const replyResult = await replyIntelligence.runOnce();
    const result = await loop.runOnce();

    console.log(JSON.stringify({
        ok: result.ok,
        cycleId: result.cycleId,
        autonomy: result.autonomy,
        businessHealth: result.businessHealth,
        healthScore: result.health?.overallScore,
        missionPriorities: result.mission?.priorities?.length || 0,
        workCreated: result.workCreated?.total || 0,
        workflowsQueued: result.workflowResults?.length || 0,
        executionPasses: result.executionResults?.length || 0,

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

        winBackRevenue: {
            ok: winBackResult.ok,
            status: winBackResult.status,
            filesDiscovered: winBackResult.localHistory?.filesDiscovered || 0,
            exactTargetFilesFound: winBackResult.localHistory?.exactTargetFilesFound || [],
            recoveredRecords: winBackResult.localHistory?.recordsRecovered || 0,
            priorConversationCandidates: winBackResult.reconstruction?.priorConversationCount || 0,
            reactivationCandidates: winBackResult.reconstruction?.reactivationCount || 0,
            eligibleForDraftStaging: winBackResult.campaignPlan?.totalEligible || 0,
            nextAction: winBackResult.nextAction || null,
            instantlyMutationRequested: false,
            activationAllowed: false,
            artifact: winBackResult.artifact || null
        },

        replyIntelligenceRevenue: {
            ok: replyResult.ok,
            status: replyResult.status,
            newReplies: replyResult.fetched?.newRows || 0,
            humanReplies: replyResult.latest?.humanReplies || 0,
            qualifiedPositiveReplies: replyResult.latest?.qualifiedPositiveReplies || 0,
            suppressions: replyResult.suppressionsAddedOrConfirmed || 0,
            followups: replyResult.followupsScheduled || 0,
            manualReview: replyResult.manualReview || 0,
            alerts: replyResult.alerts || [],
            instantlyReadOnly: true,
            autoRepliesAllowed: false
        },

        outputs: {
            executive: "DATA/executive/latest_coo_cycle.md",
            mission: "DATA/executive/latest_mission_plan.json",
            health: "DATA/executive/latest_universal_health.json",
            repair: "DATA/autonomous_repair/latest_repair_plan.json",
            backlog: "DATA/capability_backlog/latest_capability_backlog.json",
            cycle: "DATA/runtime/latest_coo_cycle.json",
            captureCapacity: "DATA/runtime/revenue/capture_capacity/production_lane_latest.json",
            winBack: "DATA/runtime/revenue/winback/production_lane_latest.json",
            replyIntelligence: "DATA/runtime/revenue/replies/reply_intelligence_latest.json",
            replyKpis: "DATA/runtime/revenue/replies/reply_kpis_latest.json",
            qualifiedReplyQueue: "DATA/runtime/revenue/replies/qualified_reply_queue.json",
            suppressionMaster: "DATA/runtime/revenue/replies/global_suppression_master.json"
        }
    }, null, 2));
}

main().catch(err => {
    console.error("[MILES] Autonomous COO failed:", err.stack || err.message);
    process.exitCode = 1;
});
