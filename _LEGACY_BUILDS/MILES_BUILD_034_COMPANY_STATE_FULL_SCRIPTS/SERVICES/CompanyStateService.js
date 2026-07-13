"use strict";

/**
 * MILES Company State Service
 * BUILD_034
 *
 * Purpose:
 * Creates one operating state for P2GC.
 *
 * Inputs:
 * - DATA/repository/repository_registry.json
 * - DATA/capability/capability_registry.json
 * - DATA/executive_brain/latest_executive_decision.json
 * - DATA/runtime/work_queue.json
 * - DATA/runtime/latest_coo_cycle.json
 * - DATA/latest_executive_state.json
 * - DATA/latest_executive_brief.json
 *
 * Outputs:
 * - DATA/company_state/company_state.json
 * - DATA/company_state/company_health.json
 * - DATA/company_state/company_state_report.md
 */

const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT || "D:\\P2GC_Intelligence\\MILES_OS";
const OUT_DIR = path.join(ROOT, "DATA", "company_state");

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

function writeJson(name, value) {
    ensureDir(OUT_DIR);
    fs.writeFileSync(
        path.join(OUT_DIR, name),
        JSON.stringify(value, null, 2),
        "utf8"
    );
}

function countQueue(queue, predicate) {
    const items = queue?.items || [];
    return items.filter(predicate).length;
}

class CompanyStateService {
    run(input = {}) {
        const startedAt = Date.now();

        console.log("");
        console.log("========================================");
        console.log(" BUILD_034 Company State");
        console.log("========================================");

        const state = this.buildState(input);
        this.save(state);

        const durationMs = Date.now() - startedAt;

        console.log("");
        console.log("Company State Complete");
        console.log(`Health Score: ${state.health.score}`);
        console.log(`Health Status: ${state.health.status}`);
        console.log(`Open Work: ${state.operations.workQueue.open}`);
        console.log("");

        return {
            ok: true,
            action: "COMPANY_STATE",
            generatedAt: state.generatedAt,
            durationMs,
            outDir: OUT_DIR,
            health: state.health,
            operations: state.operations,
            priorities: state.priorities
        };
    }

    buildState(input = {}) {
        const generatedAt = new Date().toISOString();

        const repository = readJson("DATA\\repository\\repository_registry.json", {});
        const capability = readJson("DATA\\capability\\capability_registry.json", {});
        const executiveBrain = readJson("DATA\\executive_brain\\latest_executive_decision.json", {});
        const workQueue = readJson("DATA\\runtime\\work_queue.json", { items: [] });
        const cooCycle = readJson("DATA\\runtime\\latest_coo_cycle.json", {});
        const executiveState = readJson("DATA\\latest_executive_state.json", {});
        const executiveBrief = readJson("DATA\\latest_executive_brief.json", {});

        const operations = this.buildOperations(workQueue, executiveBrain, cooCycle);
        const systems = this.buildSystems(repository, capability);
        const business = this.buildBusiness(executiveState, executiveBrief);
        const risks = this.buildRisks(repository, capability, operations, systems, business);
        const priorities = this.buildPriorities(risks, operations, systems, business);
        const health = this.scoreHealth(risks, operations, systems, business);

        return {
            ok: true,
            type: "MILES_COMPANY_STATE",
            generatedAt,
            mission: "MILES operates P2GC autonomously except CEO-governed decisions.",
            business,
            operations,
            systems,
            risks,
            priorities,
            health,
            inputs: {
                repositoryRegistryGeneratedAt: repository.generatedAt || null,
                capabilityRegistryGeneratedAt: capability.generatedAt || null,
                latestExecutiveBrainGeneratedAt: executiveBrain.generatedAt || null,
                latestCOOCycleGeneratedAt: cooCycle.generatedAt || null
            },
            metadata: {
                source: input.source || "CompanyStateService",
                build: "BUILD_034"
            }
        };
    }

    buildBusiness(executiveState, executiveBrief) {
        const revenue = executiveState.revenue || executiveBrief.revenue || {};
        const marketing = executiveState.marketing || executiveBrief.marketing || {};
        const orion = executiveState.orion || executiveBrief.orion || {};
        const clients = executiveState.clients || executiveBrief.clients || {};
        const exceptions = executiveState.exceptions || executiveBrief.exceptions || [];

        return {
            revenue: {
                goal: revenue.goal || revenue.revenueGoal || 10000,
                current: revenue.current || revenue.revenueThisMonth || revenue.closed || 0,
                pipeline: revenue.pipeline || revenue.pipelineValue || 0,
                proposalsOutstanding: revenue.proposalsOutstanding || 0,
                status: revenue.status || "UNKNOWN"
            },
            marketing: {
                totalCampaigns: marketing.totalCampaigns || 0,
                activeCampaigns: marketing.activeCampaigns || 0,
                pausedCampaigns: marketing.pausedCampaigns || 0,
                emailsSentToday: marketing.emailsSentToday || 0,
                status: marketing.status || "UNKNOWN"
            },
            orion: {
                status: orion.status || "UNKNOWN",
                lastRefresh: orion.lastRefresh || null,
                datasetsReady: Boolean(orion.datasetsReady)
            },
            clients: {
                active: clients.active || clients.activeClients || 0,
                pendingDeliverables: clients.pendingDeliverables || 0,
                status: clients.status || "UNKNOWN"
            },
            exceptions
        };
    }

    buildOperations(workQueue, executiveBrain, cooCycle) {
        const items = workQueue.items || [];

        return {
            workQueue: {
                total: items.length,
                open: countQueue(workQueue, item => ["Pending", "Queued", "In Progress", "Blocked", "Awaiting Approval"].includes(item.status)),
                pending: countQueue(workQueue, item => item.status === "Pending"),
                queued: countQueue(workQueue, item => item.status === "Queued"),
                inProgress: countQueue(workQueue, item => item.status === "In Progress"),
                blocked: countQueue(workQueue, item => item.status === "Blocked"),
                awaitingApproval: countQueue(workQueue, item => item.status === "Awaiting Approval"),
                completed: countQueue(workQueue, item => item.status === "Completed"),
                failed: countQueue(workQueue, item => item.status === "Failed")
            },
            latestExecutiveDecision: {
                decision: executiveBrain.decision?.decision || executiveBrain.decision || null,
                approvalRequired: Boolean(executiveBrain.approvalRequired),
                workItemId: executiveBrain.workItem?.id || executiveBrain.workItemId || null,
                nextAction: executiveBrain.nextAction || null
            },
            latestCOOCycle: {
                generatedAt: cooCycle.generatedAt || null,
                status: cooCycle.status || "UNKNOWN",
                summary: cooCycle.summary || null
            }
        };
    }

    buildSystems(repository, capability) {
        return {
            repository: {
                healthScore: repository.health?.score || 0,
                healthStatus: repository.health?.status || "UNKNOWN",
                totalFiles: repository.statistics?.totalFiles || 0,
                totalComponents: repository.statistics?.totalComponents || 0,
                services: repository.statistics?.services || 0,
                workers: repository.statistics?.workers || 0,
                providers: repository.statistics?.providers || 0,
                connectors: repository.statistics?.connectors || 0,
                duplicateRisks: repository.statistics?.duplicateRisks || 0,
                orphanRisks: repository.statistics?.orphanRisks || 0
            },
            capability: {
                autonomyScore: capability.autonomy?.score || 0,
                autonomyStatus: capability.autonomy?.status || "UNKNOWN",
                totalCapabilities: capability.statistics?.totalCapabilities || 0,
                executableCapabilities: capability.statistics?.executableCapabilities || 0,
                gaps: capability.statistics?.gaps || 0
            }
        };
    }

    buildRisks(repository, capability, operations, systems, business) {
        const risks = [];

        if ((repository.statistics?.duplicateRisks || 0) > 100) {
            risks.push({
                severity: "MEDIUM",
                area: "Engineering",
                message: `Repository has ${repository.statistics.duplicateRisks} duplicate risks.`,
                action: "Track but do not stop COO build."
            });
        }

        if ((repository.statistics?.orphanRisks || 0) > 50) {
            risks.push({
                severity: "MEDIUM",
                area: "Engineering",
                message: `Repository has ${repository.statistics.orphanRisks} orphan risks.`,
                action: "Track for future cleanup."
            });
        }

        if ((capability.statistics?.gaps || 0) > 0) {
            risks.push({
                severity: "LOW",
                area: "Capability",
                message: `Capability registry reports ${capability.statistics.gaps} gap(s).`,
                action: "Continue COO build sequence."
            });
        }

        if (operations.workQueue.awaitingApproval > 0) {
            risks.push({
                severity: "HIGH",
                area: "Executive",
                message: `${operations.workQueue.awaitingApproval} work item(s) awaiting Kevin approval.`,
                action: "Surface in Executive Dashboard."
            });
        }

        if (operations.workQueue.blocked > 0) {
            risks.push({
                severity: "HIGH",
                area: "Operations",
                message: `${operations.workQueue.blocked} blocked work item(s).`,
                action: "Route to Executive Brain."
            });
        }

        if (business.marketing.totalCampaigns > 0 && business.marketing.activeCampaigns < 2) {
            risks.push({
                severity: "MEDIUM",
                area: "Marketing",
                message: "Outbound campaign coverage may be low.",
                action: "Queue marketing review."
            });
        }

        return risks;
    }

    buildPriorities(risks, operations, systems, business) {
        const priorities = [];

        if (operations.workQueue.awaitingApproval > 0) {
            priorities.push({
                priority: 1,
                area: "Executive",
                title: "Review CEO approval queue",
                reason: "Items require Kevin decision."
            });
        }

        if (operations.workQueue.blocked > 0) {
            priorities.push({
                priority: 1,
                area: "Operations",
                title: "Clear blocked work items",
                reason: "Blocked items reduce autonomy."
            });
        }

        priorities.push({
            priority: 2,
            area: "Revenue",
            title: "Continue revenue-generation workflows",
            reason: "Revenue growth remains the highest business objective."
        });

        priorities.push({
            priority: 3,
            area: "Engineering",
            title: "Continue autonomous COO build sequence",
            reason: "Task Router and COO Loop are the next required builds."
        });

        return priorities;
    }

    scoreHealth(risks, operations, systems, business) {
        let score = 100;

        for (const risk of risks) {
            if (risk.severity === "HIGH") score -= 12;
            if (risk.severity === "MEDIUM") score -= 6;
            if (risk.severity === "LOW") score -= 2;
        }

        if (systems.repository.healthScore && systems.repository.healthScore < 75) score -= 8;
        if (systems.capability.autonomyScore && systems.capability.autonomyScore < 80) score -= 8;

        score = Math.max(0, Math.min(100, score));

        return {
            score,
            status:
                score >= 90 ? "HEALTHY" :
                score >= 75 ? "WATCH" :
                score >= 60 ? "NEEDS_ATTENTION" :
                "CRITICAL",
            riskCount: risks.length,
            openWork: operations.workQueue.open,
            awaitingApproval: operations.workQueue.awaitingApproval
        };
    }

    save(state) {
        ensureDir(OUT_DIR);
        writeJson("company_state.json", state);
        writeJson("company_health.json", {
            generatedAt: state.generatedAt,
            health: state.health,
            risks: state.risks,
            priorities: state.priorities
        });

        fs.writeFileSync(
            path.join(OUT_DIR, "company_state_report.md"),
            this.renderReport(state),
            "utf8"
        );
    }

    renderReport(state) {
        const risks = state.risks.length
            ? state.risks.map(r => `- ${r.severity} / ${r.area}: ${r.message}`).join("\n")
            : "- No active risks.";

        const priorities = state.priorities.length
            ? state.priorities.map(p => `- P${p.priority} / ${p.area}: ${p.title}`).join("\n")
            : "- No priorities.";

        return `# MILES Company State Report

Generated: ${state.generatedAt}

## Health

Status: ${state.health.status}  
Score: ${state.health.score}

## Work Queue

Open: ${state.operations.workQueue.open}  
Pending: ${state.operations.workQueue.pending}  
Blocked: ${state.operations.workQueue.blocked}  
Awaiting Approval: ${state.operations.workQueue.awaitingApproval}

## Repository

Components: ${state.systems.repository.totalComponents}  
Services: ${state.systems.repository.services}  
Workers: ${state.systems.repository.workers}  
Connectors: ${state.systems.repository.connectors}

## Capability

Capabilities: ${state.systems.capability.totalCapabilities}  
Executable: ${state.systems.capability.executableCapabilities}  
Autonomy Score: ${state.systems.capability.autonomyScore}

## Risks

${risks}

## Priorities

${priorities}
`;
    }
}

module.exports = new CompanyStateService();
