"use strict";

const fs = require("fs");
const path = require("path");

const workforce = require("./WorkforceService");
const executiveState = require("./ExecutiveStateService");
const providerAuthority = require("./ProviderAuthorityRegistryService");
const providerBindings = require("./ProviderCapabilityBindingService");

const EnterpriseCapabilityRegistryService =
  require("./registry/EnterpriseCapabilityRegistryService");

const ROOT = process.env.MILES_ROOT || process.cwd();

const ENTERPRISE_CAPABILITY_NAMES = Object.freeze({
  "website.health.repair": [
    "AUDIT_WEBSITE",
    "RUN_HEALTH_CHECK",
    "RECOVER_SERVICE"
  ],
  "website.health.verify": [
    "AUDIT_WEBSITE",
    "RUN_HEALTH_CHECK"
  ],
  "marketing.campaign.audit": [
    "CHECK_DELIVERABILITY",
    "SYNC_CAMPAIGNS",
    "MANAGE_MARKETING"
  ],
  "orion.refresh": [
    "QUERY_ORION",
    "RUN_HEALTH_CHECK",
    "SCORE_CONTRACTOR",
    "SCORE_OPPORTUNITY"
  ],
  "executive.objective.evaluate": [
    "CREATE_PLAN",
    "PRIORITIZE_WORK",
    "EVALUATE_AUTHORITY"
  ]
});

const CAPABILITY_REGISTRY = Object.freeze([
  {
    capability: "website.health.repair",
    provider: "WebsiteProvider",
    providerKey: "website",
    department: "Website",
    workforce: "Website Operations Workforce",
    action: "verifyWebsite",
    authorityOperation: "HEALTH_CHECK",
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
    providerKey: "website",
    department: "Website",
    workforce: "Website Operations Workforce",
    action: "verifyWebsite",
    authorityOperation: "HEALTH_CHECK",
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
    providerKey: "instantly",
    department: "Marketing",
    workforce: "Marketing Operations Workforce",
    action: "refresh",
    authorityOperation: "LIST_CAMPAIGNS",
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
    providerKey: "orion",
    department: "ORION",
    workforce: "ORION Data Operations Workforce",
    action: "refresh",
    authorityOperation: "VERIFY_DATABASE",
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
  providerKey: "general_operations",
  department: "Executive",
  workforce: "Executive Operations Workforce",
  action: "evaluateObjective",
  authorityOperation: "GENERATE_RECOMMENDATION",
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

function safeRun(service, input = {}) {
  try {
    return service.run(input);
  } catch (err) {
    return {
      ok: false,
      error: err.message
    };
  }
}

class CapabilityService {
  constructor() {
    this.enterpriseRegistry =
      new EnterpriseCapabilityRegistryService({
        rootDir: ROOT
      });
  }

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
      providerKey: entry.providerKey,
      department: entry.department,
      workforce: entry.workforce,
      action: entry.action,
      authorityOperation: entry.authorityOperation,
      enterpriseCapabilities:
        ENTERPRISE_CAPABILITY_NAMES[entry.capability] || [],
      taskType: entry.taskType,
      priority: entry.priority,
      expectedOutput: entry.expectedOutput,
      verification: entry.verification
    }));
  }

  findWorkers(capability) {
    return workforce.findByCapability(capability);
  }

  getCapability(capability) {
    const key = String(capability || "").trim().toLowerCase();

    return CAPABILITY_REGISTRY.find(
      entry => entry.capability.toLowerCase() === key
    ) || null;
  }

  enterpriseResolution(capability) {
    const names =
      ENTERPRISE_CAPABILITY_NAMES[capability] || [];

    const attempts = [];

    for (const name of names) {
      try {
        const result = this.enterpriseRegistry.resolve(name);
        attempts.push(result);

        if (result.ok) {
          return {
            ok: true,
            selectedCapability: name,
            result,
            attempts
          };
        }
      } catch (err) {
        attempts.push({
          ok: false,
          capabilityName: name,
          status: "ENTERPRISE_RESOLUTION_ERROR",
          error: err.message
        });
      }
    }

    return {
      ok: false,
      selectedCapability: null,
      result: null,
      attempts
    };
  }

  authorityResolution(providerKey, operation) {
    const authorityRegistry = safeRun(providerAuthority);
    const bindingRegistry = safeRun(providerBindings);

    const provider = (authorityRegistry.providers || [])
      .find(item => item.key === providerKey);

    const binding =
      bindingRegistry.bindings?.[providerKey] || null;

    const operationBinding =
      binding?.operations?.[operation] || null;

    return {
      provider: provider || null,
      binding,
      operationBinding,
      registryAvailable:
        Boolean(authorityRegistry.ok && bindingRegistry.ok)
    };
  }

  resolveObjective(objective, context = {}) {
    let resolved = null;

    if (context.capability) {
      const explicit = this.getCapability(context.capability);

      if (explicit) {
        resolved = {
          ...clone(explicit),
          provider: context.provider || explicit.provider,
          department:
            context.department || explicit.department,
          action: context.action || explicit.action,
          resolution: "EXPLICIT_CAPABILITY"
        };
      }
    }

    if (!resolved) {
      const text = normalizeText(objective, context);

      for (const entry of CAPABILITY_REGISTRY) {
        if (entry.patterns.some(pattern => pattern.test(text))) {
          resolved = clone(entry);
          delete resolved.patterns;

          resolved = {
            ...resolved,
            provider: context.provider || resolved.provider,
            department:
              context.department || resolved.department,
            action: context.action || resolved.action,
            resolution: "OBJECTIVE_MATCH"
          };

          break;
        }
      }
    }

    if (!resolved) {
      resolved = {
        ...clone(EXECUTIVE_FALLBACK),
        provider: context.provider || null,
        department:
          context.department ||
          EXECUTIVE_FALLBACK.department,
        action:
          context.action ||
          EXECUTIVE_FALLBACK.action,
        resolution: "EXECUTIVE_FALLBACK"
      };
    }

    const enterprise =
      this.enterpriseResolution(resolved.capability);

    const authority =
      this.authorityResolution(
        resolved.providerKey,
        resolved.authorityOperation
      );

    return {
      ...resolved,
      enterprise,
      authority,
      registryResolution:
        enterprise.ok
          ? "ENTERPRISE_REGISTRY_RESOLVED"
          : "LOCAL_CANONICAL_FALLBACK"
    };
  }

  planObjective(objective, context = {}) {
    const resolved =
      this.resolveObjective(objective, context);

    const candidates =
      this.findWorkers(resolved.capability);

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
      taskType:
        resolved.taskType || "WORKFORCE_STEP",
      assignedTo,
      status: "QUEUED",
      dependsOn: [],
      expectedOutput: resolved.expectedOutput,
      verification: resolved.verification,
      registryMetadata: {
        registryResolution:
          resolved.registryResolution,
        enterpriseCapability:
          resolved.enterprise?.selectedCapability || null,
        enterpriseProvider:
          resolved.enterprise?.result?.preferredProvider || null,
        providerAuthorityStatus:
          resolved.authority?.provider?.status || null,
        providerSafeMode:
          resolved.authority?.provider?.safeMode ?? null,
        operationAuthorized:
          resolved.authority?.operationBinding?.authorized ?? null
      }
    };

    return {
      ok: true,
      objective,
      domain:
        String(
          resolved.department || "Executive"
        ).toLowerCase(),
      workforce: resolved.workforce,
      resolution: resolved.resolution,
      registryResolution:
        resolved.registryResolution,
      enterpriseResolution:
        resolved.enterprise,
      authorityResolution:
        resolved.authority,
      requiredCapabilities: [
        resolved.capability
      ],
      assignments: [{
        capability: resolved.capability,
        provider: resolved.provider,
        department: resolved.department,
        action: resolved.action,
        bestWorker: bestWorker || null,
        candidates
      }],
      operationalPlan: {
        domain:
          String(
            resolved.department || "Executive"
          ).toLowerCase(),
        workforce: resolved.workforce,
        providers:
          resolved.provider
            ? [resolved.provider]
            : [],
        approvalRequired: false,
        steps: [step],
        verificationChecklist: [
          resolved.verification
        ],
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
