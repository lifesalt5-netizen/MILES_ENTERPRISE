"use strict";

const workforce = require("./WorkforceService");
const executiveState = require("./ExecutiveStateService");

const CAPABILITY_REGISTRY = Object.freeze([
  {
    capability: "website.health.repair",
    provider: "WebsiteProvider",
    department: "Website",
    workforce: "Website Operations Workforce",
    action: "verifyWebsite",
    taskType: "WORKFORCE_STEP",
    priority: 100,
    patterns: [
      /websiteproviderloadfailure/i,
      /\brepair\s+(the\s+)?website\b/i,
      /\bwebsite\b.*\b(broken|failed|failure|down|unavailable|critical|repair)\b/i,
      /\b(broken|failed|failure|down|unavailable|critical|repair)\b.*\bwebsite\b/i
    ],
    expectedOutput: "Verified website health, availability, content signals, and repair evidence.",
    verification: "Verify WebsiteProvider executed verifyWebsite and returned provider evidence without a provider load failure."
  },
  {
    capability: "website.health.verify",
    provider: "WebsiteProvider",
    department: "Website",
    workforce: "Website Operations Workforce",
    action: "verifyWebsite",
    taskType: "WORKFORCE_STEP",
    priority: 85,
    patterns: [
      /\bverify\s+(the\s+)?website\b/i,
      /\bwebsite\s+(health|audit|status|availability|ssl|dns)\b/i,
      /\b(audit|check|inspect|monitor)\b.*\bwebsite\b/i
    ],
    expectedOutput: "Current website health report with metrics, exceptions, and recommendations.",
    verification: "Verify the website audit produced current metrics and provider evidence."
  },
  {
    capability: "marketing.campaign.audit",
    provider: "MarketingProvider",
    department: "Marketing",
    workforce: "Marketing Operations Workforce",
    action: "refresh",
    taskType: "WORKFORCE_STEP",
    priority: 85,
    patterns: [
      /\binstantly\b/i,
      /\bcampaign\b.*\b(audit|health|verify|review|status|paused|bounce|deliverability)\b/i,
      /\b(audit|health|verify|review|status|paused|bounce|deliverability)\b.*\bcampaign\b/i,
      /\bemail\s+outreach\b/i
    ],
    expectedOutput: "Current Instantly campaign health, active/paused campaign counts, exceptions, and recommendations.",
    verification: "Verify MarketingProvider returned current campaign metrics and no unhandled provider failure."
  },
  {
    capability: "orion.refresh",
    provider: "OrionProvider",
    department: "ORION",
    workforce: "ORION Data Operations Workforce",
    action: "refresh",
    taskType: "WORKFORCE_STEP",
    priority: 85,
    patterns: [
      /\borion\b.*\b(refresh|sync|update|health|verify|audit|load)\b/i,
      /\b(refresh|sync|update|health|verify|audit|load)\b.*\borion\b/i,
      /\bgovernment\s+data\b.*\b(refresh|sync|update|verify)\b/i
    ],
    expectedOutput: "Refreshed ORION provider state, metrics, exceptions, and recommendations.",
    verification: "Verify OrionProvider completed refresh and returned provider evidence."
  }
]);

const EXECUTIVE_FALLBACK = Object.freeze({
  capability: "executive.objective.evaluate",
  provider: null,
  department: "Executive",
  workforce: "Executive Operations Workforce",
  action: "evaluateObjective",
  taskType: "WORKFORCE_STEP",
  priority: 50,
  expectedOutput: "Clear interpretation of the work objective.",
  verification: "Verify the objective is actionable and aligned to P2GC operating priorities."
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeText(objective, context = {}) {
  return [
    objective,
    context.title,
    context.area,
    context.type,
    context.provider,
    context.capability,
    context.action
  ].filter(Boolean).join(" ");
}

class CapabilityService {
  buildGraph() {
    const graph = workforce.capabilityGraph();

    executiveState.update("capabilities", {
      count: Object.keys(graph).length,
      graph
    });

    executiveState.update("workforce", workforce.status());

    return {
      ok: true,
      capabilities: Object.keys(graph).length,
      graph
    };
  }

  registry() {
    return CAPABILITY_REGISTRY.map(entry => ({
      capability: entry.capability,
      provider: entry.provider,
      department: entry.department,
      workforce: entry.workforce,
      action: entry.action,
      taskType: entry.taskType,
      priority: entry.priority,
      expectedOutput: entry.expectedOutput,
      verification: entry.verification
    }));
  }

  findWorkers(capability) {
    const graph = this.buildGraph().graph;
    const q = String(capability || "").toLowerCase();

    return Object.entries(graph)
      .filter(([cap]) => cap.includes(q) || q.includes(cap))
      .map(([matchedCapability, employees]) => ({
        capability: matchedCapability,
        employees
      }));
  }

  getCapability(capability) {
    const key = String(capability || "").trim().toLowerCase();
    return CAPABILITY_REGISTRY.find(
      entry => entry.capability.toLowerCase() === key
    ) || null;
  }

  resolveObjective(objective, context = {}) {
    if (context.capability) {
      const explicit = this.getCapability(context.capability);
      if (explicit) {
        return {
          ...clone(explicit),
          provider: context.provider || explicit.provider,
          department: context.department || explicit.department,
          action: context.action || explicit.action,
          resolution: "EXPLICIT_CAPABILITY"
        };
      }
    }

    const text = normalizeText(objective, context);

    for (const entry of CAPABILITY_REGISTRY) {
      if (entry.patterns.some(pattern => pattern.test(text))) {
        const resolved = clone(entry);
        delete resolved.patterns;

        return {
          ...resolved,
          provider: context.provider || resolved.provider,
          department: context.department || resolved.department,
          action: context.action || resolved.action,
          resolution: "OBJECTIVE_MATCH"
        };
      }
    }

    return {
      ...clone(EXECUTIVE_FALLBACK),
      provider: context.provider || null,
      department: context.department || EXECUTIVE_FALLBACK.department,
      action: context.action || EXECUTIVE_FALLBACK.action,
      resolution: "EXECUTIVE_FALLBACK"
    };
  }

  planObjective(objective, context = {}) {
    const resolved = this.resolveObjective(objective, context);
    const candidates = this.findWorkers(resolved.capability);
    const bestWorker =
      candidates?.[0]?.employees?.[0] ||
      null;

    const assignedTo =
      context.assignedTo ||
      bestWorker?.employee ||
      bestWorker?.name ||
      "MILES";

    const step = {
      step: 1,
      capability: resolved.capability,
      provider: resolved.provider,
      department: resolved.department,
      action: resolved.action,
      taskType: resolved.taskType || "WORKFORCE_STEP",
      assignedTo,
      status: "QUEUED",
      dependsOn: [],
      expectedOutput: resolved.expectedOutput,
      verification: resolved.verification
    };

    return {
      ok: true,
      objective,
      domain: String(resolved.department || "Executive").toLowerCase(),
      workforce: resolved.workforce,
      resolution: resolved.resolution,
      requiredCapabilities: [resolved.capability],
      assignments: [{
        capability: resolved.capability,
        provider: resolved.provider,
        department: resolved.department,
        action: resolved.action,
        bestWorker: bestWorker || null,
        candidates
      }],
      operationalPlan: {
        domain: String(resolved.department || "Executive").toLowerCase(),
        workforce: resolved.workforce,
        providers: resolved.provider ? [resolved.provider] : [],
        approvalRequired: false,
        steps: [step],
        verificationChecklist: [resolved.verification],
        successCriteria: [
          resolved.provider
            ? `${resolved.provider}.${resolved.action} executes through ProviderRouterService.`
            : "The objective is evaluated and routed without bypassing governance."
        ]
      }
    };
  }
}

module.exports = new CapabilityService();
