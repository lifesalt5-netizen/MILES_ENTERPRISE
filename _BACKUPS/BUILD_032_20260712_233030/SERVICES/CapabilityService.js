"use strict";

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
  ],
  "sales.reply.process": [
    "READ_EMAIL",
    "QUALIFY_LEAD",
    "CREATE_FOLLOW_UP"
  ],
  "sales.pipeline.review": [
    "MANAGE_PIPELINE",
    "QUALIFY_LEAD",
    "CREATE_FOLLOW_UP"
  ],
  "sales.proposal.review": [
    "MANAGE_PIPELINE",
    "GENERATE_EXECUTIVE_REPORT"
  ],
  "google.workspace.audit": [
    "HEALTH_CHECK",
    "LIST_USERS",
    "VERIFY_MAILBOX"
  ],
  "google.inbox.review": [
    "READ_EMAIL",
    "VERIFY_MAILBOX"
  ],
  "google.calendar.review": [
    "READ_CALENDAR",
    "HEALTH_CHECK"
  ],
  "google.drive.review": [
    "READ_DRIVE",
    "HEALTH_CHECK"
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
  },
  {
    capability: "sales.reply.process",
    provider: "SalesProvider",
    providerKey: "crm",
    department: "Sales",
    workforce: "Sales Operations Workforce",
    action: "processReplies",
    authorityOperation: "READ_PIPELINE",
    taskType: "WORKFORCE_STEP",
    priority: 100,
    patterns: [
      /\breview\s+and\s+classify\b.*\brepl/i,
      /\binbound\b.*\brepl/i,
      /\bprocess\b.*\brepl/i,
      /\bclassify\b.*\brepl/i
    ],
    expectedOutput: "Classified inbound replies with prioritized follow-up actions and CEO-protected escalations.",
    verification: "Verify SalesProvider produced reply classifications, follow-up recommendations, and persisted evidence."
  },
  {
    capability: "sales.proposal.review",
    provider: "SalesProvider",
    providerKey: "crm",
    department: "Sales",
    workforce: "Sales Operations Workforce",
    action: "reviewProposals",
    authorityOperation: "READ_PIPELINE",
    taskType: "WORKFORCE_STEP",
    priority: 100,
    patterns: [
      /\bproposal\b.*\b(deadline|due|compliance|submission|readiness|review)\b/i,
      /\b(review|prepare)\b.*\bproposal\b/i
    ],
    expectedOutput: "Prioritized proposal deadline and submission-readiness report.",
    verification: "Verify SalesProvider identified urgent proposals, due dates, and protected submission actions."
  },
  {
    capability: "sales.pipeline.review",
    provider: "SalesProvider",
    providerKey: "crm",
    department: "Sales",
    workforce: "Sales Operations Workforce",
    action: "reviewPipeline",
    authorityOperation: "READ_PIPELINE",
    taskType: "WORKFORCE_STEP",
    priority: 90,
    patterns: [
      /\breview\b.*\b(active\s+)?(revenue|sales)\s+pipeline\b/i,
      /\bactive\s+deals\b/i,
      /\boverdue\s+follow-up\b/i,
      /\bnext-action\s+work\b/i
    ],
    expectedOutput: "Current pipeline value, weighted forecast, stalled deals, and next-action queue.",
    verification: "Verify SalesProvider generated pipeline metrics and prioritized next actions."
  },
  {
    capability: "google.workspace.audit",
    provider: "GoogleWorkspaceProvider",
    providerKey: "google_workspace",
    department: "Infrastructure",
    workforce: "Google Workspace Operations Workforce",
    action: "auditWorkspace",
    authorityOperation: "HEALTH_CHECK",
    taskType: "WORKFORCE_STEP",
    priority: 85,
    patterns: [
      /\bgoogle\s+workspace\b.*\b(health|audit|verify|review|status)\b/i,
      /\b(audit|verify|review|check)\b.*\bgoogle\s+workspace\b/i,
      /\bworkspace\s+health\b/i
    ],
    expectedOutput: "Google Workspace account, Gmail, Calendar, and Drive operating-health report.",
    verification: "Verify GoogleWorkspaceProvider produced read-only workspace evidence for all registered accounts."
  },
  {
    capability: "google.inbox.review",
    provider: "GoogleWorkspaceProvider",
    providerKey: "google_workspace",
    department: "Sales",
    workforce: "Google Workspace Operations Workforce",
    action: "reviewInbox",
    authorityOperation: "VERIFY_MAILBOX",
    taskType: "WORKFORCE_STEP",
    priority: 95,
    patterns: [
      /\b(review|triage|check|monitor)\b.*\b(gmail|inbox|email)\b/i,
      /\b(gmail|inbox|email)\b.*\b(review|triage|check|monitor)\b/i,
      /\binbound\s+email\b/i
    ],
    expectedOutput: "Read-only Gmail inbox summary with recent-message counts and operational risks.",
    verification: "Verify GoogleWorkspaceProvider reviewed registered Gmail accounts without sending or modifying messages."
  },
  {
    capability: "google.calendar.review",
    provider: "GoogleWorkspaceProvider",
    providerKey: "google_workspace",
    department: "Executive",
    workforce: "Google Workspace Operations Workforce",
    action: "reviewCalendar",
    authorityOperation: "HEALTH_CHECK",
    taskType: "WORKFORCE_STEP",
    priority: 85,
    patterns: [
      /\b(review|check|monitor)\b.*\b(calendar|meetings|appointments)\b/i,
      /\b(calendar|meetings|appointments)\b.*\b(review|check|monitor)\b/i,
      /\bupcoming\s+meetings\b/i
    ],
    expectedOutput: "Read-only calendar summary with upcoming-event counts and account-level exceptions.",
    verification: "Verify GoogleWorkspaceProvider reviewed upcoming calendar activity without creating or changing events."
  },
  {
    capability: "google.drive.review",
    provider: "GoogleWorkspaceProvider",
    providerKey: "google_workspace",
    department: "Operations",
    workforce: "Google Workspace Operations Workforce",
    action: "reviewDrive",
    authorityOperation: "HEALTH_CHECK",
    taskType: "WORKFORCE_STEP",
    priority: 70,
    patterns: [
      /\b(review|check|monitor)\b.*\b(google\s+drive|drive\s+files|documents)\b/i,
      /\b(google\s+drive|drive\s+files)\b.*\b(review|check|monitor)\b/i
    ],
    expectedOutput: "Read-only Google Drive activity and document-availability summary.",
    verification: "Verify GoogleWorkspaceProvider reviewed Drive activity without creating, deleting, or changing files."
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
    const names = ENTERPRISE_CAPABILITY_NAMES[capability] || [];
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

    const binding = bindingRegistry.bindings?.[providerKey] || null;
    const operationBinding = binding?.operations?.[operation] || null;

    return {
      provider: provider || null,
      binding,
      operationBinding,
      registryAvailable: Boolean(
        authorityRegistry.ok &&
        bindingRegistry.ok
      )
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
          department: context.department || explicit.department,
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
            department: context.department || resolved.department,
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
          context.department || EXECUTIVE_FALLBACK.department,
        action:
          context.action || EXECUTIVE_FALLBACK.action,
        resolution: "EXECUTIVE_FALLBACK"
      };
    }

    const enterprise = this.enterpriseResolution(resolved.capability);
    const authority = this.authorityResolution(
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
    const resolved = this.resolveObjective(objective, context);

    const preferred = workforce.resolvePreferredWorker(
      resolved.enterprise?.result?.preferredProvider || null,
      resolved.capability
    );

    const candidateGroups = this.findWorkers(resolved.capability);
    const bestWorker = preferred.worker || null;

    const assignedTo =
      context.assignedTo ||
      bestWorker?.employee ||
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
      verification: resolved.verification,
      registryMetadata: {
        registryResolution: resolved.registryResolution,
        enterpriseCapability:
          resolved.enterprise?.selectedCapability || null,
        enterprisePreferredComponent:
          resolved.enterprise?.result?.preferredProvider || null,
        workerAssignmentSource: preferred.source,
        providerAuthorityStatus:
          resolved.authority?.provider?.status || null,
        providerSafeMode:
          resolved.authority?.provider?.safeMode ?? null,
        operationAuthorized:
          resolved.authority?.operationBinding?.authorized ?? null,
        missingCredentials:
          resolved.authority?.provider?.credentials?.missingEnv || []
      }
    };

    return {
      ok: true,
      objective,
      domain:
        String(resolved.department || "Executive").toLowerCase(),
      workforce: resolved.workforce,
      resolution: resolved.resolution,
      registryResolution: resolved.registryResolution,
      enterpriseResolution: resolved.enterprise,
      authorityResolution: resolved.authority,
      workerResolution: preferred,
      requiredCapabilities: [resolved.capability],
      assignments: [{
        capability: resolved.capability,
        provider: resolved.provider,
        department: resolved.department,
        action: resolved.action,
        bestWorker: bestWorker || null,
        candidates: candidateGroups
      }],
      operationalPlan: {
        domain:
          String(resolved.department || "Executive").toLowerCase(),
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


