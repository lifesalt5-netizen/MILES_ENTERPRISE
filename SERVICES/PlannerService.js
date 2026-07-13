"use strict";

const fs = require("fs");
const path = require("path");
const capabilityService = require("./CapabilityService");

const ROOT = process.env.MILES_ROOT || process.cwd();
const RULES_PATH = path.join(ROOT, "CONFIG", "WORKFLOWS", "planning_rules.json");

function loadRules() {
  if (!fs.existsSync(RULES_PATH)) return {};

  try {
    return JSON.parse(fs.readFileSync(RULES_PATH, "utf8"));
  } catch (err) {
    console.error("[PlannerService] planning_rules.json could not be parsed:", err.message);
    return {};
  }
}

function inferPriority(objective = "") {
  const text = String(objective || "").toLowerCase();

  if (/urgent|critical|today|deadline|due|broken|failed|failure|down|paused|bounce|blocked/.test(text)) {
    return "CRITICAL";
  }

  if (/revenue|sales|client|proposal|dreamers|campaign|orion|instantly|lead|pipeline|website|linkedin|usaspending|gsa|va fss|sam|government data/.test(text)) {
    return "HIGH";
  }

  if (/review|improve|audit|update|check|refresh|inspect|monitor|verify/.test(text)) {
    return "MEDIUM";
  }

  return "LOW";
}

function requiresApproval(objective = "", context = {}) {
  if (context.approvalRequired === true) return true;

  const text = String(objective || "").toLowerCase();

  return /pricing|price change|change pricing|discount|proposal send|send proposal|submit proposal|contract sign|sign agreement|legal|lawsuit|terminate client|fire employee|hire employee|bank account|wire transfer|purchase|buy software|buy domain|new spend|spend money|delete database|delete client|delete data|tax|payroll/.test(text);
}

class PlannerService {
  createPlan(objective, context = {}) {
    const rules = loadRules();
    const priority = context.priority || inferPriority(objective);
    const capabilityPlan = capabilityService.planObjective(objective, context);
    const operationalPlan = capabilityPlan.operationalPlan || {};

    const requiredCapabilities = capabilityPlan.requiredCapabilities || [];
    const assignments = capabilityPlan.assignments || [];
    const assignmentByCapability = Object.fromEntries(
      assignments.map(assignment => [assignment.capability, assignment])
    );

    const steps = (operationalPlan.steps || []).map((step, index) => {
      const assignment = assignmentByCapability[step.capability] || {};
      const best = assignment.bestWorker || {};
      const candidate = assignment.candidates?.[0]?.employees?.[0] || null;

      return {
        step: step.step || index + 1,
        capability: step.capability,
        assignedTo:
          step.assignedTo ||
          best.employee ||
          best.name ||
          candidate?.employee ||
          candidate?.name ||
          "MILES",
        department:
          step.department ||
          assignment.department ||
          best.department ||
          candidate?.department ||
          operationalPlan.workforce ||
          "Executive",
        status: step.status || "QUEUED",
        dependsOn: Array.isArray(step.dependsOn) ? step.dependsOn : [],
        taskType: step.taskType || "WORKFORCE_STEP",
        provider:
          step.provider ||
          assignment.provider ||
          context.provider ||
          null,
        action:
          step.action ||
          assignment.action ||
          context.action ||
          "evaluateObjective",
        expectedOutput:
          step.expectedOutput ||
          `${step.capability} operational result`,
        verification:
          step.verification ||
          `Verify ${step.capability} completed through the authoritative execution path.`
      };
    });

    if (steps.length === 0) {
      throw new Error(
        `PlannerService produced no executable steps for objective: ${objective}`
      );
    }

    const approvalRequired =
      requiresApproval(objective, context) ||
      Boolean(operationalPlan.approvalRequired);

    return {
      ok: true,
      type: "PLAN",
      objective,
      priority,
      priorityScore:
        context.priorityScore ||
        rules.priorityScale?.[priority] ||
        50,
      createdAt: new Date().toISOString(),
      owner: "MILES",
      context,
      domain:
        capabilityPlan.domain ||
        operationalPlan.domain ||
        context.domain ||
        "executive",
      workforce:
        capabilityPlan.workforce ||
        operationalPlan.workforce ||
        "Executive Operations Workforce",
      resolution: capabilityPlan.resolution || "UNKNOWN",
      requiredCapabilities,
      assignments,
      steps,
      providers:
        operationalPlan.providers ||
        steps.map(step => step.provider).filter(Boolean),
      executionAuthority:
        approvalRequired
          ? "CEO_APPROVAL_REQUIRED"
          : "MILES_AUTONOMOUS_COO",
      approvalRequired,
      verificationChecklist:
        operationalPlan.verificationChecklist || [],
      successCriteria:
        operationalPlan.successCriteria || [],
      rulesVersion: rules.version || "unknown"
    };
  }

  requiresApproval(objective = "", context = {}) {
    return requiresApproval(objective, context);
  }
}

module.exports = new PlannerService();
