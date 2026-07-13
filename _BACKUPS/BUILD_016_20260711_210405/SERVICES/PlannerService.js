"use strict";

const fs = require("fs");
const path = require("path");
const capabilityService = require("./CapabilityService");

const ROOT = process.env.MILES_ROOT || "D:\\P2GC_Intelligence\\MILES_OS";
const RULES_PATH = path.join(ROOT, "CONFIG", "WORKFLOWS", "planning_rules.json");

function loadRules() {
  if (!fs.existsSync(RULES_PATH)) return {};
  return JSON.parse(fs.readFileSync(RULES_PATH, "utf8"));
}

function inferPriority(objective = "") {
  const text = String(objective || "").toLowerCase();

  if (/urgent|critical|today|deadline|due|broken|failed|down|paused|bounce|blocked/.test(text)) {
    return "CRITICAL";
  }

  if (/revenue|sales|client|proposal|dreamers|campaign|orion|instantly|lead|pipeline|website|linkedin|usaspending|gsa|va fss|sam|government data/.test(text)) {
    return "HIGH";
  }

  if (/review|improve|audit|update|check|refresh|inspect|monitor/.test(text)) {
    return "MEDIUM";
  }

  return "LOW";
}

function requiresApproval(objective = "", context = {}) {
  if (context.approvalRequired === true) {
    return true;
  }

  const text = String(objective || "").toLowerCase();

  if (
    /pricing|price change|change pricing|discount|proposal send|send proposal|submit proposal|contract sign|sign agreement|legal|lawsuit|terminate client|fire employee|hire employee|bank account|wire transfer|purchase|buy software|buy domain|new spend|spend money|delete database|delete client|delete data|tax|payroll/.test(text)
  ) {
    return true;
  }

  return false;
}

class PlannerService {
  createPlan(objective, context = {}) {
    const rules = loadRules();
    const priority = context.priority || inferPriority(objective);
    const capabilityPlan = capabilityService.planObjective(objective, context);
    const operationalPlan = capabilityPlan.operationalPlan || {};

    const requiredCapabilities = capabilityPlan.requiredCapabilities || [];
    const assignments = capabilityPlan.assignments || [];

    const assignmentByCapability = {};
    for (const assignment of assignments) {
      assignmentByCapability[assignment.capability] = assignment;
    }

    const steps = (operationalPlan.steps || []).map((step, index) => {
      const assignment = assignmentByCapability[step.capability] || {};
      const best = assignment.bestWorker || {};
      const candidate = assignment.candidates?.[0]?.employees?.[0] || null;

      return {
        step: step.step || index + 1,
        capability: step.capability,
        assignedTo: step.assignedTo || best.employee || candidate?.employee || candidate?.name || "MILES",
        department: step.department || best.department || candidate?.department || operationalPlan.workforce || "Executive",
        status: step.status || "QUEUED",
        dependsOn: step.dependsOn || [],
        taskType: step.taskType || "WORKFORCE_STEP",
        provider: step.provider || context.provider || null,
        action: step.action || context.action || `Execute workforce step: ${step.capability}`,
        expectedOutput: step.expectedOutput || `${step.capability} recommendation`,
        verification: step.verification || `Verify ${step.capability} output is actionable and aligned with CEO rules.`
      };
    });

    const approvalRequired =
      requiresApproval(objective, context) ||
      Boolean(operationalPlan.approvalRequired);

    return {
      ok: true,
      type: "PLAN",
      objective,
      priority,
      priorityScore: context.priorityScore || rules.priorityScale?.[priority] || 50,
      createdAt: new Date().toISOString(),
      owner: "MILES",
      context,

      domain: capabilityPlan.domain || operationalPlan.domain || context.domain || "executive",
      workforce: capabilityPlan.workforce || operationalPlan.workforce || "Executive Operations Workforce",

      requiredCapabilities,
      assignments,
      steps,

      providers: operationalPlan.providers || (context.provider ? [context.provider] : []),
      executionAuthority: approvalRequired ? "CEO_APPROVAL_REQUIRED" : "MILES_AUTONOMOUS_COO",
      approvalRequired,

      verificationChecklist: operationalPlan.verificationChecklist || [],
      successCriteria: operationalPlan.successCriteria || [],

      rulesVersion: rules.version || "unknown"
    };
  }

  requiresApproval(objective = "", context = {}) {
    return requiresApproval(objective, context);
  }
}

module.exports = new PlannerService();