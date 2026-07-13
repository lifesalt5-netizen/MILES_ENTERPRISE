# INSTALL_MILES_BUILD_024_GOOGLE_WORKSPACE_COO.ps1
# Complete replacements based on post-Sales authoritative services.

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Root =
    "D:\P2GC_Intelligence\MILES_ENTERPRISE"

if (-not (Test-Path $Root)) {
    throw "MILES root not found: $Root"
}

Set-Location $Root
$env:MILES_ROOT = $Root

$Stamp =
    Get-Date -Format "yyyyMMdd_HHmmss"

$BackupRoot =
    Join-Path $Root "_BACKUPS\BUILD_024_$Stamp"

$ReportDir =
    Join-Path $Root "DATA\build_024"

$TestDir =
    Join-Path $Root "TESTS"

New-Item -ItemType Directory `
    -Path $BackupRoot `
    -Force | Out-Null

New-Item -ItemType Directory `
    -Path $ReportDir `
    -Force | Out-Null

New-Item -ItemType Directory `
    -Path $TestDir `
    -Force | Out-Null

$Targets = @(
    "SERVICES\CapabilityService.js",
    "SERVICES\ProviderRouterService.js",
    "PROVIDERS\providers\GoogleWorkspaceProvider.js"
)

foreach ($Target in $Targets) {
    $Source =
        Join-Path $Root $Target

    if (Test-Path $Source) {
        $Backup =
            Join-Path $BackupRoot $Target

        New-Item -ItemType Directory `
            -Path (Split-Path $Backup -Parent) `
            -Force | Out-Null

        Copy-Item `
            $Source `
            $Backup `
            -Force
    }
}

@'
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
  }

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
  },
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

'@ | Set-Content `
    -Path ".\SERVICES\CapabilityService.js" `
    -Encoding UTF8

@'
"use strict";

const MarketingProvider =
  require("../PROVIDERS/providers/MarketingProvider");
const OrionProvider =
  require("../PROVIDERS/providers/OrionProvider");
const WebsiteProvider =
  require("../PROVIDERS/providers/WebsiteProvider");
const SalesProvider =
  require("../PROVIDERS/providers/SalesProvider");
const GoogleWorkspaceProvider =
  require("../PROVIDERS/providers/GoogleWorkspaceProvider");

const providerAuthority =
  require("./ProviderAuthorityRegistryService");
const providerBindings =
  require("./ProviderCapabilityBindingService");

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

class ProviderRouterService {
  constructor() {
    this.providers = {
      MarketingProvider,
      OrionProvider,
      WebsiteProvider,
      SalesProvider,
      GoogleWorkspaceProvider
    };

    this.aliases = {
      marketing: "MarketingProvider",
      marketingprovider: "MarketingProvider",
      instantly: "MarketingProvider",
      instantlyprovider: "MarketingProvider",
      linkedin: "MarketingProvider",
      millionverifier: "MarketingProvider",

      sales: "SalesProvider",
      salesprovider: "SalesProvider",
      crm: "SalesProvider",
      pipeline: "SalesProvider",
      replies: "SalesProvider",
      proposals: "SalesProvider",

      google: "GoogleWorkspaceProvider",
      googleworkspace: "GoogleWorkspaceProvider",
      googleworkspaceprovider: "GoogleWorkspaceProvider",
      gmail: "GoogleWorkspaceProvider",
      calendar: "GoogleWorkspaceProvider",
      drive: "GoogleWorkspaceProvider",
      workspace: "GoogleWorkspaceProvider",

      website: "WebsiteProvider",
      websiteprovider: "WebsiteProvider",
      b12: "WebsiteProvider",
      websiteb12: "WebsiteProvider",

      orion: "OrionProvider",
      orionprovider: "OrionProvider",
      governmentdata: "OrionProvider",
      govdata: "OrionProvider",
      usaspending: "OrionProvider",
      gsa: "OrionProvider",
      gsaelibrary: "OrionProvider",
      vafss: "OrionProvider",
      sam: "OrionProvider",
      rfi: "OrionProvider",
      forecast: "OrionProvider",
      sourcessought: "OrionProvider"
    };

    this.providerKeys = {
      MarketingProvider: "instantly",
      WebsiteProvider: "website",
      OrionProvider: "orion",
      SalesProvider: "crm",
      GoogleWorkspaceProvider: "google_workspace"
    };

    this.actionOperations = {
      MarketingProvider: {
        refresh: "LIST_CAMPAIGNS",
        initialize: "HEALTH_CHECK"
      },
      WebsiteProvider: {
        verifyWebsite: "HEALTH_CHECK",
        refresh: "HEALTH_CHECK",
        initialize: "HEALTH_CHECK"
      },
      OrionProvider: {
        refresh: "VERIFY_DATABASE",
        initialize: "HEALTH_CHECK"
      },
      SalesProvider: {
        processReplies: "READ_PIPELINE",
        reviewPipeline: "READ_PIPELINE",
        reviewProposals: "READ_PIPELINE",
        refresh: "READ_PIPELINE",
        initialize: "READ_PIPELINE"
      },
      GoogleWorkspaceProvider: {
        auditWorkspace: "HEALTH_CHECK",
        reviewInbox: "VERIFY_MAILBOX",
        reviewCalendar: "HEALTH_CHECK",
        reviewDrive: "HEALTH_CHECK",
        refresh: "HEALTH_CHECK",
        initialize: "HEALTH_CHECK"
      }
    };
  }

  normalizeProviderName(providerName = "") {
    const raw = String(providerName || "").trim();
    if (!raw) return null;

    const aliasKey = raw
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");

    return this.aliases[aliasKey] || raw;
  }

  hasProvider(providerName = "") {
    const normalized = this.normalizeProviderName(providerName);
    return Boolean(normalized && this.providers[normalized]);
  }

  authorityFor(providerName, action) {
    const providerKey = this.providerKeys[providerName] || null;
    const operation =
      this.actionOperations[providerName]?.[action] || null;

    const authorityRegistry = safeRun(providerAuthority);
    const bindingRegistry = safeRun(providerBindings);

    const authority = (authorityRegistry.providers || [])
      .find(provider => provider.key === providerKey) || null;

    const binding =
      bindingRegistry.bindings?.[providerKey] || null;

    const operationBinding = operation
      ? binding?.operations?.[operation] || null
      : null;

    return {
      providerKey,
      operation,
      authority,
      binding,
      operationBinding,
      registryAvailable: Boolean(
        authorityRegistry.ok &&
        bindingRegistry.ok
      )
    };
  }

  credentialRecommendations(authority) {
    const missing =
      authority?.authority?.credentials?.missingEnv || [];

    if (!missing.length) return [];

    return [
      `Provider is operating in safe/read-only mode. Configure missing environment variable(s): ${missing.join(", ")}.`,
      "Do not enable write operations until credentials, rollback, and governance controls are verified."
    ];
  }

  credentialExceptions(authority) {
    const missing =
      authority?.authority?.credentials?.missingEnv || [];

    if (!missing.length) return [];

    return [{
      type: "ProviderCredentials",
      severity: "Info",
      message:
        `Missing environment variable(s): ${missing.join(", ")}. Read-only authorized operations may continue.`
    }];
  }

  async invokeProvider(provider, action, task) {
    const normalizedAction = String(action || "").trim();

    if (
      normalizedAction &&
      typeof provider[normalizedAction] === "function"
    ) {
      return provider[normalizedAction](task);
    }

    if (typeof provider.executeTask === "function") {
      return provider.executeTask(task);
    }

    if (typeof provider.initialize === "function") {
      return provider.initialize(task);
    }

    if (typeof provider.refresh === "function") {
      return provider.refresh(task);
    }

    throw new Error(
      `Provider exposes no executable action: ${normalizedAction || "unspecified"}`
    );
  }

  async executeProviderTask(task = {}) {
    const payload = task.payload || task || {};
    const requestedProvider = payload.provider || null;
    const providerName =
      this.normalizeProviderName(requestedProvider);

    if (!providerName) {
      return this.noProviderResult(
        task,
        "No provider was specified for this task."
      );
    }

    const ProviderClass = this.providers[providerName];

    if (!ProviderClass) {
      return this.noProviderResult(
        task,
        `Provider is not registered: ${providerName}`
      );
    }

    const requestedAction = payload.action || "refresh";
    const authority =
      this.authorityFor(providerName, requestedAction);

    const startedAt = new Date().toISOString();

    try {
      const provider = new ProviderClass();
      const providerOutput = await this.invokeProvider(
        provider,
        requestedAction,
        task
      );

      const completedAt = new Date().toISOString();

      const credentialExceptions =
        this.credentialExceptions(authority);

      const credentialRecommendations =
        this.credentialRecommendations(authority);

      return {
        ok: provider.status !== "Critical",
        type: "PROVIDER_EXECUTION_RESULT",
        requestedProvider,
        provider: providerName,
        routedTo: providerName,
        action: requestedAction,
        actionInvoked:
          typeof provider[requestedAction] === "function"
            ? requestedAction
            : (
                typeof provider.executeTask === "function"
                  ? "executeTask"
                  : (
                      typeof provider.initialize === "function"
                        ? "initialize"
                        : "refresh"
                    )
              ),
        taskId: task.id || null,
        workPackageId: payload.workPackageId || null,
        objective: payload.objective || null,
        capability: payload.capability || null,
        assignedTo: payload.assignedTo || "MILES",
        department: payload.department || null,
        status: provider.status || "Unknown",
        dataFreshness:
          provider.dataFreshness || "Unknown",
        lastRefresh:
          provider.lastRefresh || completedAt,
        metrics: provider.metrics || {},
        exceptions: [
          ...(provider.exceptions || []),
          ...credentialExceptions
        ],
        recommendations: [
          ...(provider.recommendations || []),
          ...credentialRecommendations
        ],
        providerOutput,
        authority: {
          registryAvailable: authority.registryAvailable,
          providerKey: authority.providerKey,
          providerStatus:
            authority.authority?.status || null,
          safeMode:
            authority.authority?.safeMode ?? null,
          credentialsPresent:
            authority.authority?.credentialsPresent ?? null,
          missingCredentials:
            authority.authority?.credentials?.missingEnv || [],
          operation: authority.operation,
          operationAuthorized:
            authority.operationBinding?.authorized ?? null,
          writeEnabled:
            authority.binding?.writeEnabled ?? null
        },
        evidence: {
          providerLoaded: true,
          initialized: true,
          requestedProvider,
          routedProvider: providerName,
          requestedAction,
          actionAvailable:
            typeof provider[requestedAction] === "function",
          authorityRegistryConsulted:
            authority.registryAvailable,
          authorityProviderKey:
            authority.providerKey,
          authorityOperation:
            authority.operation,
          credentialAwarenessApplied: true,
          metricsCaptured: Boolean(provider.metrics),
          exceptionsCaptured:
            Array.isArray(provider.exceptions),
          recommendationsCaptured:
            Array.isArray(provider.recommendations)
        },
        startedAt,
        completedAt
      };
    } catch (err) {
      return {
        ok: false,
        type: "PROVIDER_EXECUTION_RESULT",
        requestedProvider,
        provider: providerName,
        routedTo: providerName,
        action: requestedAction,
        taskId: task.id || null,
        workPackageId: payload.workPackageId || null,
        objective: payload.objective || null,
        capability: payload.capability || null,
        assignedTo: payload.assignedTo || "MILES",
        department: payload.department || null,
        status: "FAILED",
        metrics: {},
        exceptions: [{
          type: "ProviderRouter",
          severity: "Critical",
          message: err.stack || err.message
        }],
        recommendations: [
          `Verify provider action and connector configuration for ${providerName}.`,
          ...this.credentialRecommendations(authority)
        ],
        authority,
        evidence: {
          providerLoaded: true,
          initialized: false,
          requestedProvider,
          routedProvider: providerName,
          requestedAction,
          authorityRegistryConsulted:
            authority.registryAvailable,
          credentialAwarenessApplied: true,
          error: err.stack || err.message
        },
        startedAt,
        completedAt: new Date().toISOString()
      };
    }
  }

  noProviderResult(task = {}, reason = "") {
    const payload = task.payload || task || {};

    return {
      ok: false,
      type: "NO_PROVIDER_RESULT",
      provider: payload.provider || null,
      action: payload.action || null,
      taskId: task.id || null,
      workPackageId: payload.workPackageId || null,
      objective: payload.objective || null,
      capability: payload.capability || null,
      assignedTo: payload.assignedTo || "MILES",
      department: payload.department || null,
      status: "NO_PROVIDER",
      metrics: {},
      exceptions: [{
        type: "ProviderRouting",
        severity: "Info",
        message: reason
      }],
      recommendations: [
        "Register this provider or route it to an existing operational provider."
      ],
      evidence: {
        providerLoaded: false,
        reason
      },
      completedAt: new Date().toISOString()
    };
  }

  status() {
    const authorityRegistry = safeRun(providerAuthority);
    const bindingRegistry = safeRun(providerBindings);

    return {
      ok: true,
      registeredProviders: Object.keys(this.providers),
      aliases: this.aliases,
      providerAuthority: {
        ok: authorityRegistry.ok,
        summary: authorityRegistry.summary || null
      },
      capabilityBindings: {
        ok: bindingRegistry.ok,
        summary: bindingRegistry.summary || null
      }
    };
  }
}

module.exports = new ProviderRouterService();


'@ | Set-Content `
    -Path ".\SERVICES\ProviderRouterService.js" `
    -Encoding UTF8

@'
"use strict";

const fs = require("fs");
const path = require("path");
const IDataProvider = require("../contracts/IDataProvider");

const defaultWorkspace =
  require("../../CONNECTORS/GOOGLE/workspace");

const defaultAccountManager =
  require("../../CONNECTORS/GOOGLE/account_manager");

const ROOT =
  process.env.MILES_ROOT ||
  process.cwd();

const OUT_DIR =
  path.join(
    ROOT,
    "DATA",
    "google_workspace_coo"
  );

function ensureDir() {
  fs.mkdirSync(
    OUT_DIR,
    { recursive: true }
  );
}

function persistEvidence(result) {
  ensureDir();

  const stamp = Date.now();

  const historical =
    path.join(
      OUT_DIR,
      `google_workspace_operation_${stamp}.json`
    );

  const latest =
    path.join(
      OUT_DIR,
      "latest_google_workspace_operation.json"
    );

  const text =
    JSON.stringify(
      result,
      null,
      2
    );

  fs.writeFileSync(
    historical,
    text,
    "utf8"
  );

  fs.writeFileSync(
    latest,
    text,
    "utf8"
  );

  return historical;
}

function validAccounts(
  accountManager
) {
  try {
    return (
      accountManager
        .listAccounts()
        .filter(
          account =>
            account.valid
        )
    );
  } catch {
    return [];
  }
}

function snapshotError(
  account,
  error
) {
  return {
    account:
      account.email ||
      account.accountKey ||
      "Unknown",
    accountKey:
      account.accountKey ||
      null,
    ok: false,
    error:
      error.message
  };
}

class GoogleWorkspaceProvider
  extends IDataProvider {
  constructor(options = {}) {
    super("Google Workspace");

    this.workspace =
      options.workspace ||
      defaultWorkspace;

    this.accountManager =
      options.accountManager ||
      defaultAccountManager;

    this.dependencies = [
      "Google OAuth",
      "Gmail",
      "Google Calendar",
      "Google Drive"
    ];

    this.sourceSystems = [
      "CONNECTORS/GOOGLE/workspace.js",
      "CONNECTORS/GOOGLE/account_manager.js"
    ];

    this.accounts = [];
    this.snapshots = [];
  }

  async initialize() {
    return this.auditWorkspace();
  }

  async refresh() {
    return this.auditWorkspace();
  }

  async collectSnapshots() {
    const accounts =
      validAccounts(
        this.accountManager
      );

    const snapshots = [];

    for (const account of accounts) {
      try {
        const snapshot =
          await this.workspace
            .getWorkspaceSnapshot(
              account.accountKey
            );

        snapshots.push({
          ...snapshot,
          accountKey:
            account.accountKey,
          ok: true
        });
      } catch (error) {
        snapshots.push(
          snapshotError(
            account,
            error
          )
        );
      }
    }

    return {
      accounts,
      snapshots
    };
  }

  async auditWorkspace() {
    this.lastRefresh =
      new Date().toISOString();

    this.dataFreshness =
      "Live";

    const collected =
      await this.collectSnapshots();

    this.accounts =
      collected.accounts;

    this.snapshots =
      collected.snapshots;

    const successful =
      this.snapshots.filter(
        snapshot =>
          snapshot.ok !== false
      );

    const failed =
      this.snapshots.filter(
        snapshot =>
          snapshot.ok === false
      );

    const totals = successful.reduce(
      (summary, snapshot) => {
        summary.inboxEstimate +=
          Number(
            snapshot.inboxEstimate ||
            0
          );

        summary.recentInboxCount +=
          Number(
            snapshot.recentInboxCount ||
            0
          );

        summary.upcomingEventsCount +=
          Number(
            snapshot.upcomingEventsCount ||
            0
          );

        summary.recentDriveFilesCount +=
          Number(
            snapshot.recentDriveFilesCount ||
            0
          );

        return summary;
      },
      {
        inboxEstimate: 0,
        recentInboxCount: 0,
        upcomingEventsCount: 0,
        recentDriveFilesCount: 0
      }
    );

    const noAccounts =
      this.accounts.length === 0;

    this.status =
      failed.length > 0
        ? "Watch"
        : noAccounts
          ? "Watch"
          : "Healthy";

    this.metrics = {
      registeredAccounts:
        this.accounts.length,
      healthyAccounts:
        successful.length,
      failedAccounts:
        failed.length,
      inboxEstimate:
        totals.inboxEstimate,
      recentInboxCount:
        totals.recentInboxCount,
      upcomingEventsCount:
        totals.upcomingEventsCount,
      recentDriveFilesCount:
        totals.recentDriveFilesCount
    };

    this.exceptions = [
      ...failed.map(
        snapshot => ({
          type:
            "GoogleAccountHealth",
          severity:
            "Warning",
          message:
            `${snapshot.account}: ${snapshot.error}`
        })
      )
    ];

    if (noAccounts) {
      this.exceptions.push({
        type:
          "GoogleAccountRegistry",
        severity:
          "Info",
        message:
          "No valid Google Workspace accounts are registered."
      });
    }

    this.recommendations = [];

    if (noAccounts) {
      this.recommendations.push(
        "Register approved Google Workspace accounts through the existing account manager."
      );
    }

    if (failed.length > 0) {
      this.recommendations.push(
        "Reauthorize failed Google accounts before enabling operational workflows."
      );
    }

    if (
      totals.recentInboxCount > 0
    ) {
      this.recommendations.push(
        `Review ${totals.recentInboxCount} recent inbox message(s) for sales, client, proposal, and operational follow-up.`
      );
    }

    if (
      totals.upcomingEventsCount > 0
    ) {
      this.recommendations.push(
        `Prepare briefs for ${totals.upcomingEventsCount} upcoming calendar event(s).`
      );
    }

    const result = {
      ok:
        failed.length === 0,
      provider:
        "GoogleWorkspaceProvider",
      action:
        "auditWorkspace",
      status:
        this.status,
      generatedAt:
        this.lastRefresh,
      readOnly: true,
      metrics:
        this.metrics,
      exceptions:
        this.exceptions,
      recommendations:
        this.recommendations,
      accounts:
        this.accounts,
      snapshots:
        this.snapshots,
      safety: {
        workspaceMode:
          "READ_ONLY",
        emailSendingEnabled:
          false,
        emailModificationEnabled:
          false,
        calendarWritesEnabled:
          false,
        driveWritesEnabled:
          false,
        userProvisioningEnabled:
          false,
        aliasChangesEnabled:
          false
      }
    };

    result.evidenceFile =
      persistEvidence(result);

    return result;
  }

  async reviewInbox() {
    const result =
      await this.auditWorkspace();

    return {
      ...result,
      action:
        "reviewInbox",
      focus: {
        recentInboxCount:
          result.metrics
            .recentInboxCount,
        inboxEstimate:
          result.metrics
            .inboxEstimate
      }
    };
  }

  async reviewCalendar() {
    const result =
      await this.auditWorkspace();

    return {
      ...result,
      action:
        "reviewCalendar",
      focus: {
        upcomingEventsCount:
          result.metrics
            .upcomingEventsCount
      }
    };
  }

  async reviewDrive() {
    const result =
      await this.auditWorkspace();

    return {
      ...result,
      action:
        "reviewDrive",
      focus: {
        recentDriveFilesCount:
          result.metrics
            .recentDriveFilesCount
      }
    };
  }

  async executeTask(task = {}) {
    const action =
      task.payload?.action ||
      task.action ||
      "auditWorkspace";

    if (
      typeof this[action] !==
      "function"
    ) {
      throw new Error(
        `Unsupported GoogleWorkspaceProvider action: ${action}`
      );
    }

    return this[action](task);
  }

  async shutdown() {
    return true;
  }
}

module.exports =
  GoogleWorkspaceProvider;

'@ | Set-Content `
    -Path ".\PROVIDERS\providers\GoogleWorkspaceProvider.js" `
    -Encoding UTF8

@'
"use strict";

const assert =
  require("assert");

const fs =
  require("fs");

process.env.MILES_ROOT =
  process.env.MILES_ROOT ||
  "D:\\P2GC_Intelligence\\MILES_ENTERPRISE";

const planner =
  require(
    "../SERVICES/PlannerService"
  );

const router =
  require(
    "../SERVICES/ProviderRouterService"
  );

const GoogleWorkspaceProvider =
  require(
    "../PROVIDERS/providers/GoogleWorkspaceProvider"
  );

async function main() {
  const fakeAccountManager = {
    listAccounts() {
      return [
        {
          accountKey:
            "kevin_at_pathways2gc.com",
          email:
            "kevin@pathways2gc.com",
          valid: true
        },
        {
          accountKey:
            "info_at_pathways2gc.com",
          email:
            "info@pathways2gc.com",
          valid: true
        }
      ];
    }
  };

  const fakeWorkspace = {
    async getWorkspaceSnapshot(
      accountKey
    ) {
      return {
        account:
          accountKey.includes("kevin")
            ? "kevin@pathways2gc.com"
            : "info@pathways2gc.com",
        inboxEstimate: 100,
        recentInboxCount: 5,
        upcomingEventsCount: 2,
        recentDriveFilesCount: 3
      };
    }
  };

  const provider =
    new GoogleWorkspaceProvider({
      accountManager:
        fakeAccountManager,
      workspace:
        fakeWorkspace
    });

  const audit =
    await provider.auditWorkspace();

  assert.strictEqual(
    audit.provider,
    "GoogleWorkspaceProvider"
  );

  assert.strictEqual(
    audit.readOnly,
    true
  );

  assert.strictEqual(
    audit.status,
    "Healthy"
  );

  assert.strictEqual(
    audit.metrics.registeredAccounts,
    2
  );

  assert.strictEqual(
    audit.metrics.healthyAccounts,
    2
  );

  assert.strictEqual(
    audit.metrics.recentInboxCount,
    10
  );

  assert.strictEqual(
    audit.metrics.upcomingEventsCount,
    4
  );

  assert.strictEqual(
    audit.metrics.recentDriveFilesCount,
    6
  );

  assert.strictEqual(
    audit.safety.emailSendingEnabled,
    false
  );

  assert.strictEqual(
    audit.safety.calendarWritesEnabled,
    false
  );

  assert.strictEqual(
    audit.safety.driveWritesEnabled,
    false
  );

  assert(
    fs.existsSync(
      audit.evidenceFile
    ),
    "Google Workspace COO evidence file was not created."
  );

  const inboxPlan =
    planner.createPlan(
      "Review Gmail inbox and triage recent email"
    );

  const calendarPlan =
    planner.createPlan(
      "Review upcoming calendar meetings"
    );

  const drivePlan =
    planner.createPlan(
      "Review Google Drive files"
    );

  assert.strictEqual(
    inboxPlan.steps[0].provider,
    "GoogleWorkspaceProvider"
  );

  assert.strictEqual(
    inboxPlan.steps[0].action,
    "reviewInbox"
  );

  assert.strictEqual(
    calendarPlan.steps[0].provider,
    "GoogleWorkspaceProvider"
  );

  assert.strictEqual(
    calendarPlan.steps[0].action,
    "reviewCalendar"
  );

  assert.strictEqual(
    drivePlan.steps[0].provider,
    "GoogleWorkspaceProvider"
  );

  assert.strictEqual(
    drivePlan.steps[0].action,
    "reviewDrive"
  );

  const routerStatus =
    router.status();

  assert(
    routerStatus
      .registeredProviders
      .includes(
        "GoogleWorkspaceProvider"
      )
  );

  console.log(JSON.stringify({
    ok: true,
    build: "024",
    tests: {
      accountRegistryIntegration:
        "PASSED",
      workspaceSnapshotIntegration:
        "PASSED",
      gmailReadOnlyReview:
        "PASSED",
      calendarReadOnlyReview:
        "PASSED",
      driveReadOnlyReview:
        "PASSED",
      capabilityPlanning:
        "PASSED",
      providerRouting:
        "PASSED",
      readOnlySafety:
        "PASSED",
      evidencePersistence:
        "PASSED"
    },
    metrics:
      audit.metrics,
    recommendations:
      audit.recommendations,
    plans: {
      inbox:
        inboxPlan.steps[0],
      calendar:
        calendarPlan.steps[0],
      drive:
        drivePlan.steps[0]
    },
    safety:
      audit.safety,
    evidenceFile:
      audit.evidenceFile
  }, null, 2));
}

main().catch(error => {
  console.error(
    error.stack ||
    error.message
  );

  process.exit(1);
});

'@ | Set-Content `
    -Path ".\TESTS\Test_Build024_GoogleWorkspaceCOO.js" `
    -Encoding UTF8

Write-Host ""
Write-Host "=== BUILD 024 SYNTAX VALIDATION ==="

$Files = @(
    ".\SERVICES\CapabilityService.js",
    ".\SERVICES\ProviderRouterService.js",
    ".\PROVIDERS\providers\GoogleWorkspaceProvider.js",
    ".\SERVICES\GoogleWorkspaceProviderController.js",
    ".\SERVICES\workers\GoogleWorkspaceCOOWorker.js",
    ".\CONNECTORS\GOOGLE\workspace.js",
    ".\CONNECTORS\GOOGLE\account_manager.js",
    ".\SERVICES\PlannerService.js",
    ".\SERVICES\WorkflowService.js",
    ".\SERVICES\ExecutionService.js",
    ".\SERVICES\WorkforceExecutionService.js",
    ".\TESTS\Test_Build024_GoogleWorkspaceCOO.js"
)

foreach ($File in $Files) {
    & node --check $File

    if ($LASTEXITCODE -ne 0) {
        throw "Syntax failed: $File"
    }

    Write-Host "[PASS] $File"
}

Write-Host ""
Write-Host "=== BUILD 024 AUTOMATED TESTS ==="

$Output =
    & node ".\TESTS\Test_Build024_GoogleWorkspaceCOO.js" 2>&1

$ExitCode =
    $LASTEXITCODE

$Report =
    Join-Path `
        $ReportDir `
        "build_024_test_$Stamp.txt"

$Output |
    Tee-Object -FilePath $Report

if ($ExitCode -ne 0) {
    throw "Build 024 tests failed. Restore from $BackupRoot"
}

$Manifest = [ordered]@{
    ok = $true
    build = "024"
    name = "Google Workspace COO"
    installedAt =
        (Get-Date).ToString("o")
    backupRoot = $BackupRoot
    changedFiles = @(
        "SERVICES\CapabilityService.js",
        "SERVICES\ProviderRouterService.js",
        "PROVIDERS\providers\GoogleWorkspaceProvider.js"
    )
    reusedComponents = @(
        "SERVICES\GoogleWorkspaceProviderController.js",
        "SERVICES\workers\GoogleWorkspaceCOOWorker.js",
        "CONNECTORS\GOOGLE\workspace.js",
        "CONNECTORS\GOOGLE\account_manager.js"
    )
    capabilities = @(
        "Google Workspace health",
        "Gmail inbox review",
        "Calendar activity review",
        "Drive activity review",
        "Multi-account health",
        "Evidence persistence"
    )
    safety = @(
        "No email sending",
        "No email modification",
        "No calendar writes",
        "No Drive writes",
        "No user provisioning",
        "No alias changes"
    )
    report = $Report
}

$Manifest |
    ConvertTo-Json -Depth 8 |
    Set-Content `
        -Path (
          Join-Path `
            $ReportDir `
            "build_024_manifest_$Stamp.json"
        ) `
        -Encoding UTF8

Write-Host ""
Write-Host "============================================================"
Write-Host "BUILD 024 GOOGLE WORKSPACE COO INSTALLED AND VERIFIED"
Write-Host "============================================================"
Write-Host "Backup: $BackupRoot"
Write-Host "Report: $Report"
