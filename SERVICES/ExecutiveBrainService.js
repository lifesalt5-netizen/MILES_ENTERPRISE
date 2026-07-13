"use strict";

/**
 * MILES Executive Brain Service
 * BUILD_033
 *
 * Purpose:
 * Integrates existing MILES decision, planning, capability, and work queue services.
 *
 * Does not replace:
 * - DecisionEngine
 * - PlannerService
 * - WorkQueueService
 * - ExecutionRouterService
 * - AutonomousCOOLoopService
 */

const fs = require("fs");
const path = require("path");

const decisionEngine = require("./DecisionEngine");
const plannerService = require("./PlannerService");
const WorkQueueService = require("./WorkQueueService");

const ROOT = process.env.MILES_ROOT || "D:\\P2GC_Intelligence\\MILES_OS";
const OUT_DIR = path.join(ROOT, "DATA", "executive_brain");
const DECISION_LOG = path.join(OUT_DIR, "executive_brain_decisions.json");
const LATEST_DECISION = path.join(OUT_DIR, "latest_executive_decision.json");
const REPORT_FILE = path.join(OUT_DIR, "executive_brain_report.md");

function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}

function readJson(file, fallback) {
    try {
        if (!fs.existsSync(file)) return fallback;
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
        return fallback;
    }
}

function writeJson(file, value) {
    ensureDir(path.dirname(file));
    fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

function appendDecision(record) {
    const existing = readJson(DECISION_LOG, []);
    existing.push(record);
    writeJson(DECISION_LOG, existing.slice(-500));
}

class ExecutiveBrainService {
    constructor(options = {}) {
        this.queue = options.queue || new WorkQueueService();
    }

    run(input = {}) {
        const objective =
            input.objective ||
            input.title ||
            "Review P2GC operating state and determine next best action.";

        const context = {
            source: input.source || "ExecutiveBrainService",
            domain: input.domain || "executive",
            priority: input.priority || null,
            provider: input.provider || null,
            action: input.action || null,
            approvalRequired: input.approvalRequired === true,
            metadata: input.metadata || {}
        };

        const plan = plannerService.createPlan(objective, context);

        const decision = decisionEngine.evaluate({
            objective,
            context,
            plan,
            priority: plan.priority,
            approvalRequired: plan.approvalRequired,
            area: plan.domain || context.domain,
            source: "ExecutiveBrainService"
        });

        const workItem = this.createWorkItem(objective, plan, decision, context);

        const record = {
            ok: true,
            type: "EXECUTIVE_BRAIN_DECISION",
            generatedAt: new Date().toISOString(),
            objective,
            context,
            decision,
            plan,
            workItem,
            nextAction: this.nextAction(decision, workItem),
            queueStats: this.queue.getStats()
        };

        this.save(record);

        return {
            ok: true,
            action: "EXECUTIVE_BRAIN",
            generatedAt: record.generatedAt,
            decision: decision.decision,
            approvalRequired: decision.approval?.approvalRequired || false,
            workItemId: workItem?.id || null,
            workItemStatus: workItem?.status || null,
            priority: plan.priority,
            nextAction: record.nextAction,
            outDir: OUT_DIR
        };
    }

    createWorkItem(objective, plan, decision, context) {
        const requiresKevin =
            decision.decision === "ESCALATE" ||
            decision.approval?.approvalRequired === true ||
            plan.approvalRequired === true;

        const title = this.buildTitle(objective, plan, decision);

        return this.queue.createWorkItem({
            priority: this.priorityNumber(plan.priority),
            area: plan.domain || context.domain || "Executive",
            title,
            description: objective,
            reason: requiresKevin
                ? "Executive Brain determined this requires CEO approval."
                : "Executive Brain authorized MILES to proceed within governance.",
            source: "ExecutiveBrainService",
            owner: "MILES",
            requiresKevin,
            recommendedAction: this.recommendedAction(plan, decision),
            expectedImpact: this.expectedImpact(plan),
            relatedProvider: context.provider || null,
            executionType: requiresKevin ? "APPROVAL_REQUIRED" : "WORKFLOW",
            metadata: {
                objective,
                priority: plan.priority,
                priorityScore: plan.priorityScore,
                planType: plan.type,
                decision,
                steps: plan.steps || [],
                requiredCapabilities: plan.requiredCapabilities || [],
                assignments: plan.assignments || []
            }
        });
    }

    buildTitle(objective, plan, decision) {
        const prefix = decision.decision === "ESCALATE"
            ? "CEO Approval Required"
            : "MILES Authorized Task";

        return `${prefix}: ${String(objective).slice(0, 120)}`;
    }

    recommendedAction(plan, decision) {
        if (decision.decision === "ESCALATE") {
            return "Hold execution and route to Kevin for approval.";
        }

        if (Array.isArray(plan.steps) && plan.steps.length) {
            return plan.steps.map(s => s.action || s.capability).filter(Boolean).join(" -> ");
        }

        return "Execute approved operational workflow.";
    }

    expectedImpact(plan) {
        if (plan.priority === "CRITICAL") return "Protects business continuity or urgent revenue operations.";
        if (plan.priority === "HIGH") return "Improves revenue, delivery, marketing, or operational throughput.";
        if (plan.priority === "MEDIUM") return "Improves system quality or operational visibility.";
        return "Maintains operational progress.";
    }

    priorityNumber(priority) {
        const map = {
            CRITICAL: 1,
            HIGH: 2,
            MEDIUM: 3,
            LOW: 4
        };

        return map[String(priority || "").toUpperCase()] || 3;
    }

    nextAction(decision, workItem) {
        if (!workItem) return "No work item created.";
        if (decision.decision === "ESCALATE") return "Kevin approval required.";
        return "Task is authorized for MILES workflow execution.";
    }

    save(record) {
        ensureDir(OUT_DIR);
        writeJson(LATEST_DECISION, record);
        appendDecision(record);
        fs.writeFileSync(REPORT_FILE, this.renderReport(record), "utf8");
    }

    renderReport(record) {
        const steps = (record.plan.steps || [])
            .map(s => `- Step ${s.step}: ${s.action || s.capability || "Execute step"} — ${s.assignedTo || "MILES"}`)
            .join("\n") || "- No plan steps generated.";

        return `# MILES Executive Brain Report

Generated: ${record.generatedAt}

## Objective

${record.objective}

## Decision

Decision: ${record.decision.decision}  
Approval Required: ${record.decision.approval?.approvalRequired ? "Yes" : "No"}  
Priority: ${record.plan.priority}

## Work Item

ID: ${record.workItem?.id || "None"}  
Status: ${record.workItem?.status || "None"}  
Requires Kevin: ${record.workItem?.requiresKevin ? "Yes" : "No"}

## Plan Steps

${steps}

## Next Action

${record.nextAction}
`;
    }
}

module.exports = new ExecutiveBrainService();
