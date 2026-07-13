"use strict";

/**
 * MILES Dashboard Data Service
 * BUILD_037
 * Complete replacement file.
 *
 * Purpose:
 * Read-only aggregation layer for CEO Executive Dashboard.
 */

const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT || "D:\\P2GC_Intelligence\\MILES_OS";
const DATA_DIR = path.join(ROOT, "DATA");

function exists(file) {
    try { return fs.existsSync(file); } catch { return false; }
}

function readJson(relativePath, fallback = {}) {
    const full = path.join(ROOT, relativePath);
    try {
        if (!exists(full)) return fallback;
        return JSON.parse(fs.readFileSync(full, "utf8"));
    } catch (error) {
        return {
            _readError: true,
            file: full,
            error: error.message,
            fallback
        };
    }
}

function readText(relativePath, fallback = "") {
    const full = path.join(ROOT, relativePath);
    try {
        if (!exists(full)) return fallback;
        return fs.readFileSync(full, "utf8");
    } catch {
        return fallback;
    }
}

function fileInfo(relativePath) {
    const full = path.join(ROOT, relativePath);
    try {
        if (!exists(full)) {
            return { exists: false, path: full, modifiedAt: null, sizeBytes: 0 };
        }
        const stat = fs.statSync(full);
        return {
            exists: true,
            path: full,
            modifiedAt: stat.mtime.toISOString(),
            sizeBytes: stat.size
        };
    } catch (error) {
        return { exists: false, path: full, modifiedAt: null, sizeBytes: 0, error: error.message };
    }
}

function asNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function array(value) {
    return Array.isArray(value) ? value : [];
}

function queueItems(workQueue) {
    return array(workQueue.items || workQueue.queue || []);
}

function countByStatus(items, status) {
    return items.filter(item => String(item.status || "") === status).length;
}

function openStatuses() {
    return ["Pending", "Queued", "In Progress", "Blocked", "Awaiting Approval"];
}

function latestItems(items, limit = 10) {
    return [...items]
        .sort((a, b) =>
            String(b.updatedAt || b.createdAt || "")
            .localeCompare(
                String(a.updatedAt || a.createdAt || "")
            )
        )
        .slice(0, limit);
}


function missionFiles() {

    const dir =
        path.join(
            ROOT,
            "ENGINEERING",
            "Missions"
        );

    try {

        if (!exists(dir)) {
            return [];
        }

        return fs.readdirSync(dir)
            .filter(file => file.endsWith(".json"))
            .map(file => {

                return JSON.parse(
                    fs.readFileSync(
                        path.join(dir,file),
                        "utf8"
                    )
                );

            });

    } catch(error){

        return [];

    }

}

class DashboardDataService {
    run(input = {}) {
        return this.build(input);
    }

    build(input = {}) {
        const generatedAt = new Date().toISOString();

        const repository = readJson("DATA\\repository\\repository_registry.json", {});
        const capability = readJson("DATA\\capability\\capability_registry.json", {});
        const companyState = readJson("DATA\\company_state\\company_state.json", {});
        const companyHealth = readJson("DATA\\company_state\\company_health.json", {});
        const executiveDecision = readJson("DATA\\executive_brain\\latest_executive_decision.json", {});
        const cooCycle = readJson("DATA\\runtime\\latest_coo_cycle.json", {});
        const cooHistory = readJson("DATA\\runtime\\coo_cycle_history.json", []);
        const taskRouter = readJson("DATA\\task_router\\latest_task_router_run.json", {});
        const taskRouterHistory = readJson("DATA\\task_router\\task_router_history.json", []);
        const workQueue = readJson("DATA\\runtime\\work_queue.json", { metadata: {}, items: [] });
        const workArchive = readJson("DATA\\runtime\\work_queue_archive.json", []);
        const latestExecutiveState = readJson("DATA\\latest_executive_state.json", {});
        const latestExecutiveBrief = readJson("DATA\\latest_executive_brief.json", {});
        const engineeringMissions =
            missionFiles();

        const items = queueItems(workQueue);
        const open = items.filter(item => openStatuses().includes(item.status));
        const approvals = items.filter(item => item.status === "Awaiting Approval" || item.requiresKevin === true);
        const blocked = items.filter(item => item.status === "Blocked");
        const failed = items.filter(item => item.status === "Failed");

        const business = companyState.business || latestExecutiveState || latestExecutiveBrief || {};
        const revenue = business.revenue || latestExecutiveState.revenue || latestExecutiveBrief.revenue || {};
        const marketing = business.marketing || latestExecutiveState.marketing || latestExecutiveBrief.marketing || {};
        const orion = business.orion || latestExecutiveState.orion || latestExecutiveBrief.orion || {};
        const clients = business.clients || latestExecutiveState.clients || latestExecutiveBrief.clients || {};

        const health = companyState.health || companyHealth.health || {};
        const runtimeHealth = cooCycle.runtimeHealth || {};
        const restartGuardian = cooCycle.restartGuardian || {};

        const alerts = this.buildAlerts({ health, runtimeHealth, restartGuardian, approvals, blocked, failed, companyState, cooCycle });
        const activityFeed = this.buildActivityFeed({ executiveDecision, cooCycle, cooHistory, taskRouter, taskRouterHistory, items });

        return {
            ok: true,
            action: "EXECUTIVE_DASHBOARD_DATA",
            type: "MILES_EXECUTIVE_DASHBOARD_DATA",
            build: "BUILD_037",
            generatedAt,
            root: ROOT,
            executiveSummary: {
                companyHealthScore: asNumber(health.score, 0),
                companyHealthStatus: health.status || "UNKNOWN",
                revenueGoal: asNumber(revenue.goal || revenue.revenueGoal, 10000),
                revenueCurrent: asNumber(revenue.current || revenue.revenueThisMonth || revenue.closed, 0),
                pipeline: asNumber(revenue.pipeline || revenue.pipelineValue, 0),
                openWork: open.length,
                approvalQueue: approvals.length,
                criticalAlerts: alerts.filter(a => a.severity === "CRITICAL").length,
                warningAlerts: alerts.filter(a => a.severity === "WARNING").length,
                runtimeStatus: runtimeHealth.status || cooCycle.status || "UNKNOWN"
            },
            cooRuntime: {
                latestCycleId: cooCycle.cycleId || null,
                latestCycleGeneratedAt: cooCycle.generatedAt || null,
                latestCycleCompletedAt: cooCycle.completedAt || null,
                latestCycleStatus: cooCycle.status || "UNKNOWN",
                latestCycleDurationMs: cooCycle.durationMs || null,
                cyclesInHistory: array(cooHistory).length,
                runtimeHealthStatus: runtimeHealth.status || "UNKNOWN",
                restartRecommended: Boolean(restartGuardian.restartRecommended),
                restartRecommendation: restartGuardian.recommendation || "Unknown",
                consecutiveFailures: asNumber(restartGuardian.consecutiveFailures, 0),
                heartbeat: this.extractHeartbeat(cooCycle)
            },
            executiveBrain: {
                generatedAt: executiveDecision.generatedAt || null,
                decision: executiveDecision.decision?.decision || executiveDecision.decision || null,
                approvalRequired: Boolean(executiveDecision.decision?.approval?.approvalRequired || executiveDecision.approvalRequired),
                priority: executiveDecision.plan?.priority || executiveDecision.priority || null,
                workItemId: executiveDecision.workItem?.id || executiveDecision.workItemId || null,
                workItemStatus: executiveDecision.workItem?.status || executiveDecision.workItemStatus || null,
                nextAction: executiveDecision.nextAction || null,
                objective: executiveDecision.objective || null
            },
            companyState: {
                generatedAt: companyState.generatedAt || null,
                health,
                risks: array(companyState.risks || companyHealth.risks),
                priorities: array(companyState.priorities || companyHealth.priorities),
                operations: companyState.operations || {},
                systems: companyState.systems || {}
            },
            revenue: {
                goal: asNumber(revenue.goal || revenue.revenueGoal, 10000),
                current: asNumber(revenue.current || revenue.revenueThisMonth || revenue.closed, 0),
                pipeline: asNumber(revenue.pipeline || revenue.pipelineValue, 0),
                proposalsOutstanding: asNumber(revenue.proposalsOutstanding, 0),
                status: revenue.status || "UNKNOWN",
                progressPct: this.percent(asNumber(revenue.current || revenue.revenueThisMonth || revenue.closed, 0), asNumber(revenue.goal || revenue.revenueGoal, 10000))
            },
            marketing: {
                totalCampaigns: asNumber(marketing.totalCampaigns, 0),
                activeCampaigns: asNumber(marketing.activeCampaigns, 0),
                pausedCampaigns: asNumber(marketing.pausedCampaigns, 0),
                emailsSentToday: asNumber(marketing.emailsSentToday, 0),
                status: marketing.status || "UNKNOWN",
                instantlyStatus: marketing.instantlyStatus || marketing.status || "UNKNOWN"
            },
            engineering: {

    totalMissions:
        engineeringMissions.length,

    accepted:
        engineeringMissions.filter(
            m => m.status === "ACCEPTED"
        ).length,

    completed:
        engineeringMissions.filter(
            m => m.status === "COMPLETED"
        ).length,

    failed:
        engineeringMissions.filter(
            m => m.status === "FAILED"
        ).length,

    active:
        engineeringMissions.filter(
            m =>
            !["COMPLETED","FAILED"]
            .includes(m.status)
        ).length,

    recentMissions:
        latestItems(
            engineeringMissions,
            10
        ).map(m => ({
            id:m.id,
            title:m.title,
            status:m.status,
            updatedAt:m.updatedAt
        }))

},
            orion: {
                status: orion.status || "UNKNOWN",
                lastRefresh: orion.lastRefresh || null,
                datasetsReady: Boolean(orion.datasetsReady),
                contractors: asNumber(orion.contractors, 0),
                buyers: asNumber(orion.buyers, 0),
                vehicles: asNumber(orion.vehicles, 0)
            },
            website: this.buildWebsiteSection(),
            repository: {
                generatedAt: repository.generatedAt || null,
                health: repository.health || {},
                statistics: repository.statistics || {}
            },
            capability: {
                generatedAt: capability.generatedAt || null,
                autonomy: capability.autonomy || {},
                statistics: capability.statistics || {}
            },
            workQueue: {
                metadata: workQueue.metadata || {},
                total: items.length,
                open: open.length,
                pending: countByStatus(items, "Pending"),
                queued: countByStatus(items, "Queued"),
                inProgress: countByStatus(items, "In Progress"),
                blocked: blocked.length,
                awaitingApproval: countByStatus(items, "Awaiting Approval"),
                completed: countByStatus(items, "Completed"),
                failed: failed.length,
                archived: array(workArchive).length,
                approvalItems: latestItems(approvals, 10),
                blockedItems: latestItems(blocked, 10),
                recentItems: latestItems(items, 20)
            },
            taskRouter: {
                generatedAt: taskRouter.generatedAt || null,
                summary: taskRouter.summary || {},
                routed: array(taskRouter.routed),
                awaitingApproval: array(taskRouter.awaitingApproval),
                skipped: array(taskRouter.skipped)
            },
            alerts,
            activityFeed,
            files: {
                repository: fileInfo("DATA\\repository\\repository_registry.json"),
                capability: fileInfo("DATA\\capability\\capability_registry.json"),
                companyState: fileInfo("DATA\\company_state\\company_state.json"),
                executiveBrain: fileInfo("DATA\\executive_brain\\latest_executive_decision.json"),
                cooCycle: fileInfo("DATA\\runtime\\latest_coo_cycle.json"),
                workQueue: fileInfo("DATA\\runtime\\work_queue.json"),
                taskRouter: fileInfo("DATA\\task_router\\latest_task_router_run.json")
            },
            metadata: {
                source: input.source || "DashboardDataService",
                readOnly: true,
                dataDir: DATA_DIR
            }
        };
    }

    percent(current, goal) {
        if (!goal || goal <= 0) return 0;
        return Math.max(0, Math.min(999, Math.round((current / goal) * 100)));
    }

    extractHeartbeat(cooCycle) {
        const heartbeat = array(cooCycle.results).find(r => r.name === "HEARTBEAT");
        return heartbeat?.result || null;
    }

    buildWebsiteSection() {
        const queue = readJson("DATA\\website\\website_change_queue.json", []);
        const master = readJson("DATA\\website\\website_master.json", {});
        return {
            status: master.status || "UNKNOWN",
            pendingChanges: array(queue.items || queue).filter(item => !["Completed", "Cancelled", "Archived"].includes(item.status)).length,
            lastPublish: master.lastPublish || master.lastPublishedAt || null,
            formsStatus: master.formsStatus || "UNKNOWN",
            seoStatus: master.seoStatus || "UNKNOWN"
        };
    }

    buildAlerts(context) {
        const alerts = [];
        const add = (severity, area, title, message, action) => alerts.push({ severity, area, title, message, action });

        if ((context.health.score || 0) < 60) {
            add("CRITICAL", "Company", "Company health critical", `Health score is ${context.health.score}.`, "Review risks immediately.");
        } else if ((context.health.score || 0) < 75) {
            add("WARNING", "Company", "Company health needs attention", `Health score is ${context.health.score}.`, "Review dashboard risks.");
        }

        if (context.runtimeHealth.status && context.runtimeHealth.status !== "HEALTHY") {
            add("CRITICAL", "Runtime", "Runtime health not healthy", `Runtime status is ${context.runtimeHealth.status}.`, "Review latest COO cycle errors.");
        }

        if (context.restartGuardian.restartRecommended) {
            add("CRITICAL", "Runtime", "Restart recommended", context.restartGuardian.recommendation || "Restart guardian recommends action.", "Run guarded COO loop or inspect errors.");
        }

        if (context.approvals.length > 0) {
            add("WARNING", "Executive", "Kevin approval queue", `${context.approvals.length} item(s) require approval.`, "Review approval queue.");
        }

        if (context.blocked.length > 0) {
            add("WARNING", "Operations", "Blocked work items", `${context.blocked.length} work item(s) are blocked.`, "Route blockers to Executive Brain.");
        }

        if (context.failed.length > 0) {
            add("WARNING", "Operations", "Failed work exists", `${context.failed.length} failed item(s) remain in queue.`, "Archive closed work or review failures.");
        }

        for (const risk of array(context.companyState.risks)) {
            add(risk.severity === "HIGH" ? "WARNING" : "INFO", risk.area || "Company", risk.message || "Company risk", risk.message || "Risk detected.", risk.action || "Review.");
        }

        if (!alerts.length) {
            add("INFO", "System", "No active critical alerts", "Dashboard did not detect critical alerts.", "Continue COO loop.");
        }

        return alerts;
    }

    buildActivityFeed({ executiveDecision, cooCycle, cooHistory, taskRouter, taskRouterHistory, items }) {
        const feed = [];
        const push = (timestamp, type, title, detail) => feed.push({ timestamp: timestamp || null, type, title, detail });

        if (executiveDecision.generatedAt) {
            push(executiveDecision.generatedAt, "EXECUTIVE_BRAIN", "Latest executive decision", executiveDecision.nextAction || executiveDecision.decision?.decision || "Decision recorded.");
        }

        if (cooCycle.generatedAt) {
            push(cooCycle.generatedAt, "COO_LOOP", `COO cycle ${cooCycle.status || "UNKNOWN"}`, `Steps: ${cooCycle.summary?.steps || 0}; Errors: ${cooCycle.summary?.errors || 0}`);
        }

        for (const cycle of array(cooHistory).slice(-5)) {
            push(cycle.generatedAt, "COO_HISTORY", `Cycle ${cycle.status || "UNKNOWN"}`, `Runtime health: ${cycle.summary?.runtimeHealth || "UNKNOWN"}`);
        }

        if (taskRouter.generatedAt) {
            push(taskRouter.generatedAt, "TASK_ROUTER", "Task router run", `Routed: ${taskRouter.summary?.routed || 0}; Approval: ${taskRouter.summary?.awaitingApproval || 0}; Skipped: ${taskRouter.summary?.skipped || 0}`);
        }

        for (const run of array(taskRouterHistory).slice(-5)) {
            push(run.generatedAt, "TASK_ROUTER_HISTORY", "Router history", `Routed: ${run.summary?.routed || 0}; Open after: ${run.summary?.openAfter || 0}`);
        }

        for (const item of latestItems(items, 10)) {
            push(item.updatedAt || item.createdAt, "WORK_QUEUE", `${item.status}: ${item.title}`, item.reason || item.recommendedAction || item.area || "Work item updated.");
        }

        return feed
            .filter(item => item.timestamp)
            .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))
            .slice(0, 30);
    }
}

module.exports = new DashboardDataService();
