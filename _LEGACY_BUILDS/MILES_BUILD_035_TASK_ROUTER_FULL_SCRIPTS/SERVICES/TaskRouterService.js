"use strict";

/**
 * MILES Task Router Service
 * BUILD_035
 *
 * Purpose:
 * Routes authorized work items to the correct execution owner.
 *
 * Inputs:
 * - DATA/runtime/work_queue.json
 * - DATA/capability/capability_execution_map.json
 * - DATA/company_state/company_state.json
 *
 * Outputs:
 * - DATA/task_router/latest_task_router_run.json
 * - DATA/task_router/task_router_history.json
 * - DATA/task_router/task_router_report.md
 */

const fs = require("fs");
const path = require("path");

const WorkQueueService = require("./WorkQueueService");

const ROOT = process.env.MILES_ROOT || "D:\\P2GC_Intelligence\\MILES_OS";
const OUT_DIR = path.join(ROOT, "DATA", "task_router");
const LATEST_FILE = path.join(OUT_DIR, "latest_task_router_run.json");
const HISTORY_FILE = path.join(OUT_DIR, "task_router_history.json");
const REPORT_FILE = path.join(OUT_DIR, "task_router_report.md");

function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}

function readJson(relativePath, fallback = null) {
    const full = path.join(ROOT, relativePath);
    try {
        if (!fs.existsSync(full)) return fallback;
        return JSON.parse(fs.readFileSync(full, "utf8"));
    } catch {
        return fallback;
    }
}

function writeJson(file, value) {
    ensureDir(path.dirname(file));
    fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

function appendHistory(record) {
    const history = readAbsoluteJson(HISTORY_FILE, []);
    history.push(record);
    writeJson(HISTORY_FILE, history.slice(-500));
}

function readAbsoluteJson(file, fallback) {
    try {
        if (!fs.existsSync(file)) return fallback;
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
        return fallback;
    }
}

class TaskRouterService {
    constructor(options = {}) {
        this.queue = options.queue || new WorkQueueService();
    }

    run(input = {}) {
        const startedAt = Date.now();

        console.log("");
        console.log("========================================");
        console.log(" BUILD_035 Task Router");
        console.log("========================================");

        const result = this.route(input);
        this.save(result);

        const durationMs = Date.now() - startedAt;

        console.log("");
        console.log("Task Router Complete");
        console.log(`Routed: ${result.summary.routed}`);
        console.log(`Awaiting Approval: ${result.summary.awaitingApproval}`);
        console.log(`Skipped: ${result.summary.skipped}`);
        console.log("");

        return {
            ok: true,
            action: "TASK_ROUTER",
            generatedAt: result.generatedAt,
            durationMs,
            outDir: OUT_DIR,
            summary: result.summary
        };
    }

    route(input = {}) {
        const generatedAt = new Date().toISOString();

        const capabilityExecutionMap =
            readJson("DATA\\capability\\capability_execution_map.json", { executionMap: {} });

        const companyState =
            readJson("DATA\\company_state\\company_state.json", {});

        const pending = this.queue.getPending();
        const routed = [];
        const skipped = [];
        const awaitingApproval = [];

        const maxItems = Number(input.maxItems || 10);

        for (const item of pending.slice(0, maxItems)) {
            if (item.requiresKevin === true || item.executionType === "APPROVAL_REQUIRED") {
                const updated = this.queue.markAwaitingApproval(item.id, {
                    routedBy: "TaskRouterService",
                    routedAt: generatedAt
                });

                awaitingApproval.push({
                    id: item.id,
                    title: item.title,
                    area: item.area,
                    status: updated?.status || "Awaiting Approval",
                    reason: "Requires Kevin approval."
                });

                continue;
            }

            const route = this.resolveRoute(item, capabilityExecutionMap.executionMap || {}, companyState);

            if (!route.ok) {
                const updated = this.queue.markBlocked(item.id, {
                    routedBy: "TaskRouterService",
                    routedAt: generatedAt,
                    routeFailure: route.reason
                });

                skipped.push({
                    id: item.id,
                    title: item.title,
                    area: item.area,
                    status: updated?.status || "Blocked",
                    reason: route.reason
                });

                continue;
            }

            const updated = this.queue.markQueued(item.id, {
                routedBy: "TaskRouterService",
                routedAt: generatedAt,
                route
            });

            routed.push({
                id: item.id,
                title: item.title,
                area: item.area,
                status: updated?.status || "Queued",
                route
            });
        }

        return {
            ok: true,
            type: "MILES_TASK_ROUTER_RUN",
            generatedAt,
            source: "TaskRouterService",
            companyHealth: companyState.health || null,
            summary: {
                pendingBefore: pending.length,
                routed: routed.length,
                awaitingApproval: awaitingApproval.length,
                skipped: skipped.length,
                openAfter: this.queue.getOpen().length,
                queuedAfter: this.queue.getStats().queued
            },
            routed,
            awaitingApproval,
            skipped,
            queueStats: this.queue.getStats()
        };
    }

    resolveRoute(item, executionMap, companyState) {
        const text = [
            item.area,
            item.title,
            item.description,
            item.reason,
            item.recommendedAction,
            item.relatedProvider,
            JSON.stringify(item.metadata || {})
        ].join(" ").toLowerCase();

        const candidateCapability = this.detectCapability(text, item);

        if (!candidateCapability) {
            return {
                ok: true,
                mode: "WORK_QUEUE_ONLY",
                owner: item.owner || "MILES",
                service: "WorkQueueService",
                capability: "general_operations",
                reason: "No specific capability detected; routed as general MILES work."
            };
        }

        const cap = executionMap[candidateCapability];

        if (!cap) {
            return {
                ok: true,
                mode: "WORK_QUEUE_ONLY",
                owner: item.owner || "MILES",
                service: "WorkQueueService",
                capability: candidateCapability,
                reason: "Capability detected but no execution map entry found; queued for MILES."
            };
        }

        const executor = (cap.candidateExecutors || [])[0];

        if (!executor) {
            return {
                ok: true,
                mode: "WORK_QUEUE_ONLY",
                owner: cap.primaryOwner || item.owner || "MILES",
                service: "WorkQueueService",
                capability: candidateCapability,
                reason: "Capability found but no executable component listed; queued for MILES."
            };
        }

        return {
            ok: true,
            mode: "CAPABILITY_EXECUTOR",
            capability: candidateCapability,
            capabilityName: cap.capability,
            owner: executor.owner || cap.primaryOwner || "MILES",
            service: executor.path,
            componentTypes: executor.componentTypes || [],
            governance: cap.governance || {},
            reason: `Matched work item to ${candidateCapability}.`
        };
    }

    detectCapability(text, item) {
        if (/instantly|campaign|outbound|email|inbox|warmup|bounce/.test(text)) {
            return "outbound_campaign_operations";
        }

        if (/website|b12|seo|page|form|landing/.test(text)) {
            return "website_operations";
        }

        if (/orion|contractor|buyer|vehicle|recompete|sam|gsa|usaspending/.test(text)) {
            return "orion_intelligence_operations";
        }

        if (/revenue|sales|pipeline|proposal|client|crm/.test(text)) {
            return "revenue_operations";
        }

        if (/executive|brief|dashboard|kpi|priority/.test(text)) {
            return "executive_intelligence";
        }

        if (/runtime|pm2|health|loop|coo/.test(text)) {
            return "runtime_operations";
        }

        if (/engineering|builder|registry|scan|repair|code/.test(text)) {
            return "self_engineering_operations";
        }

        if (/learning|confidence|history|improve/.test(text)) {
            return "self_learning_operations";
        }

        return null;
    }

    save(result) {
        ensureDir(OUT_DIR);
        writeJson(LATEST_FILE, result);
        appendHistory(result);
        fs.writeFileSync(REPORT_FILE, this.renderReport(result), "utf8");
    }

    renderReport(result) {
        const routed = result.routed.length
            ? result.routed.map(r => `- ${r.id}: ${r.title} -> ${r.route.owner} / ${r.route.capability}`).join("\n")
            : "- None";

        const approval = result.awaitingApproval.length
            ? result.awaitingApproval.map(r => `- ${r.id}: ${r.title}`).join("\n")
            : "- None";

        const skipped = result.skipped.length
            ? result.skipped.map(r => `- ${r.id}: ${r.title} — ${r.reason}`).join("\n")
            : "- None";

        return `# MILES Task Router Report

Generated: ${result.generatedAt}

## Summary

Pending Before: ${result.summary.pendingBefore}  
Routed: ${result.summary.routed}  
Awaiting Approval: ${result.summary.awaitingApproval}  
Skipped/Blocked: ${result.summary.skipped}  
Open After: ${result.summary.openAfter}  
Queued After: ${result.summary.queuedAfter}

## Routed

${routed}

## Awaiting Approval

${approval}

## Skipped / Blocked

${skipped}
`;
    }
}

module.exports = new TaskRouterService();
