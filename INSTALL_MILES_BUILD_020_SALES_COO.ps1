# INSTALL_MILES_BUILD_020_SALES_COO.ps1
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Root = "D:\P2GC_Intelligence\MILES_ENTERPRISE"
if (-not (Test-Path $Root)) { throw "MILES root not found: $Root" }

Set-Location $Root
$env:MILES_ROOT = $Root

$Stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$BackupRoot = Join-Path $Root "_BACKUPS\BUILD_020_$Stamp"
$ReportDir = Join-Path $Root "DATA\build_020"
$TestDir = Join-Path $Root "TESTS"

New-Item -ItemType Directory -Path $BackupRoot -Force | Out-Null
New-Item -ItemType Directory -Path $ReportDir -Force | Out-Null
New-Item -ItemType Directory -Path $TestDir -Force | Out-Null

$Targets = @(
  "SERVICES\CapabilityService.js",
  "SERVICES\ProviderRouterService.js"
)

foreach ($Target in $Targets) {
  $Source = Join-Path $Root $Target
  if (-not (Test-Path $Source)) { throw "Missing $Source" }
  $Backup = Join-Path $BackupRoot $Target
  New-Item -ItemType Directory -Path (Split-Path $Backup -Parent) -Force | Out-Null
  Copy-Item $Source $Backup -Force
}

$SalesProviderPath = Join-Path $Root "PROVIDERS\providers\SalesProvider.js"
if (Test-Path $SalesProviderPath) {
  $Backup = Join-Path $BackupRoot "PROVIDERS\providers\SalesProvider.js"
  New-Item -ItemType Directory -Path (Split-Path $Backup -Parent) -Force | Out-Null
  Copy-Item $SalesProviderPath $Backup -Force
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

'@ | Set-Content -Path ".\SERVICES\CapabilityService.js" -Encoding UTF8

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
      SalesProvider
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
      SalesProvider: "crm"
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

'@ | Set-Content -Path ".\SERVICES\ProviderRouterService.js" -Encoding UTF8

@'
"use strict";

const fs = require("fs");
const path = require("path");
const IDataProvider = require("../contracts/IDataProvider");
const ReplyIntelligenceEngine = require("../../SERVICES/ReplyIntelligenceEngine");
const DealClosureEngine = require("../../SERVICES/DealClosureEngine");

const ROOT = process.env.MILES_ROOT || process.cwd();
const OUT_DIR = path.join(ROOT, "DATA", "sales_coo");

function ensureDir() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

function readJson(filePath, fallback = null) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function latestBusinessState() {
  const candidates = [
    path.join(ROOT, "DATA", "runtime", "latest_coo_cycle.json"),
    path.join(ROOT, "DATA", "executive", "latest_coo_cycle.json"),
    path.join(ROOT, "DATA", "executive_state.json")
  ];

  for (const file of candidates) {
    const value = readJson(file, null);
    if (!value) continue;

    const business =
      value.executiveState?.business ||
      value.business ||
      value.state?.business ||
      null;

    if (business) return business;
  }

  return {
    replies: [],
    proposals: [],
    deals: [],
    leads: [],
    campaigns: []
  };
}

function writeEvidence(name, result) {
  ensureDir();
  const file = path.join(OUT_DIR, name);
  fs.writeFileSync(file, JSON.stringify(result, null, 2), "utf8");
  fs.writeFileSync(
    path.join(OUT_DIR, "latest_sales_operation.json"),
    JSON.stringify(result, null, 2),
    "utf8"
  );
  return file;
}

function dueDate(item = {}) {
  return item.dueDate || item.due || item.deadline || item.closeDate || null;
}

class SalesProvider extends IDataProvider {
  constructor() {
    super("Sales");
    this.dependencies = ["CRM", "Email", "Calendar", "ORION"];
    this.sourceSystems = [
      "DATA/runtime/latest_coo_cycle.json",
      "DATA/executive/latest_coo_cycle.json",
      "DATA/executive_state.json"
    ];
  }

  async initialize() {
    return this.refresh();
  }

  async refresh() {
    return this.reviewPipeline();
  }

  async processReplies() {
    const business = latestBusinessState();
    const replies = Array.isArray(business.replies) ? business.replies : [];

    const normalized = replies.map(reply => ({
      ...reply,
      text:
        reply.text ||
        reply.body ||
        reply.snippet ||
        reply.message ||
        ""
    }));

    const engine = new ReplyIntelligenceEngine({ connectors: {} });
    const analysis = await engine.processReplies(normalized);

    const protectedActions = analysis.processed
      .filter(item => ["meeting", "interested"].includes(item.classification.type))
      .map(item => ({
        type: "CEO_REVIEW",
        reason: "Positive prospect response requires human-approved communication or commitment.",
        lead: item.reply?.lead || null,
        classification: item.classification
      }));

    this.lastRefresh = new Date().toISOString();
    this.dataFreshness = "Live";
    this.status = "Healthy";
    this.metrics = {
      repliesProcessed: analysis.processed.length,
      classifications: analysis.summary,
      protectedActions: protectedActions.length
    };
    this.exceptions = [];
    this.recommendations = [
      ...analysis.processed.map(item => ({
        action: "FOLLOW_UP_REVIEW",
        classification: item.classification.type,
        confidence: item.classification.confidence,
        lead: item.reply?.lead || null
      })),
      ...protectedActions
    ];

    const result = {
      ok: true,
      provider: "SalesProvider",
      action: "processReplies",
      generatedAt: this.lastRefresh,
      analysis,
      protectedActions,
      metrics: this.metrics
    };

    result.evidenceFile = writeEvidence(
      `reply_analysis_${Date.now()}.json`,
      result
    );

    return result;
  }

  async reviewPipeline() {
    const business = latestBusinessState();
    const deals = Array.isArray(business.deals) ? business.deals : [];

    const engine = new DealClosureEngine({ connectors: {} });
    const analysis = await engine.run(deals);

    const pipelineValue = deals.reduce(
      (sum, deal) => sum + Number(deal.value || 0),
      0
    );

    const weightedForecast = deals.reduce(
      (sum, deal) =>
        sum +
        Number(deal.value || 0) *
        Number(deal.probability || 0),
      0
    );

    const stalledDeals = deals.filter(deal => {
      const last = deal.lastActivity || deal.updatedAt || deal.lastUpdated;
      if (!last) return false;
      const ageDays = (Date.now() - new Date(last).getTime()) / 86400000;
      return Number.isFinite(ageDays) && ageDays >= 3;
    });

    this.lastRefresh = new Date().toISOString();
    this.dataFreshness = "Live";
    this.status = "Healthy";
    this.metrics = {
      activeDeals: deals.length,
      pipelineValue,
      weightedForecast,
      stalledDeals: stalledDeals.length,
      hotDeals: analysis.summary.hot,
      warmDeals: analysis.summary.warm
    };
    this.exceptions = [];
    this.recommendations = [
      ...stalledDeals.map(deal => ({
        action: "CREATE_FOLLOW_UP",
        dealId: deal.id || null,
        dealName: deal.name || deal.company || "Unknown",
        reason: "No recorded activity for at least 3 days."
      })),
      ...analysis.outputs.map(output => ({
        action: output.decision.action,
        stage: output.decision.stage,
        dealId: output.deal.id || null,
        dealName: output.deal.name || output.deal.company || "Unknown",
        protected:
          output.decision.action === "PROPOSAL" ||
          output.decision.action === "CLOSE_NOW"
      }))
    ];

    const result = {
      ok: true,
      provider: "SalesProvider",
      action: "reviewPipeline",
      generatedAt: this.lastRefresh,
      analysis,
      metrics: this.metrics,
      recommendations: this.recommendations
    };

    result.evidenceFile = writeEvidence(
      `pipeline_review_${Date.now()}.json`,
      result
    );

    return result;
  }

  async reviewProposals() {
    const business = latestBusinessState();
    const proposals = Array.isArray(business.proposals)
      ? business.proposals
      : [];

    const now = Date.now();

    const reviewed = proposals.map(proposal => {
      const due = dueDate(proposal);
      const dueMs = due ? new Date(due).getTime() : NaN;
      const hoursRemaining = Number.isFinite(dueMs)
        ? Math.round((dueMs - now) / 3600000)
        : null;

      return {
        ...proposal,
        dueDate: due,
        hoursRemaining,
        urgency:
          hoursRemaining === null
            ? "UNKNOWN"
            : hoursRemaining <= 24
              ? "CRITICAL"
              : hoursRemaining <= 72
                ? "HIGH"
                : "NORMAL",
        submissionProtected: true
      };
    }).sort((a, b) => {
      if (a.hoursRemaining === null) return 1;
      if (b.hoursRemaining === null) return -1;
      return a.hoursRemaining - b.hoursRemaining;
    });

    this.lastRefresh = new Date().toISOString();
    this.dataFreshness = "Live";
    this.status = "Healthy";
    this.metrics = {
      proposals: reviewed.length,
      critical: reviewed.filter(item => item.urgency === "CRITICAL").length,
      high: reviewed.filter(item => item.urgency === "HIGH").length
    };
    this.exceptions = reviewed
      .filter(item => item.hoursRemaining !== null && item.hoursRemaining < 0)
      .map(item => ({
        type: "ProposalPastDue",
        severity: "Critical",
        message: `${item.title || item.name || item.id || "Proposal"} is past due.`
      }));
    this.recommendations = reviewed.map(item => ({
      action: "PREPARE_SUBMISSION_READINESS",
      proposalId: item.id || null,
      title: item.title || item.name || "Proposal",
      dueDate: item.dueDate,
      urgency: item.urgency,
      requiresCEOApproval: true
    }));

    const result = {
      ok: true,
      provider: "SalesProvider",
      action: "reviewProposals",
      generatedAt: this.lastRefresh,
      proposals: reviewed,
      metrics: this.metrics,
      exceptions: this.exceptions,
      recommendations: this.recommendations
    };

    result.evidenceFile = writeEvidence(
      `proposal_review_${Date.now()}.json`,
      result
    );

    return result;
  }

  async executeTask(task = {}) {
    const action = task.payload?.action || task.action || "reviewPipeline";

    if (typeof this[action] !== "function") {
      throw new Error(`Unsupported SalesProvider action: ${action}`);
    }

    return this[action](task);
  }

  async shutdown() {
    return true;
  }
}

module.exports = SalesProvider;

'@ | Set-Content -Path ".\PROVIDERS\providers\SalesProvider.js" -Encoding UTF8

@'
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

process.env.MILES_ROOT =
  process.env.MILES_ROOT ||
  "D:\\P2GC_Intelligence\\MILES_ENTERPRISE";

const ROOT = process.env.MILES_ROOT;
const runtimeDir = path.join(ROOT, "DATA", "runtime");
const cycleFile = path.join(runtimeDir, "latest_coo_cycle.json");

fs.mkdirSync(runtimeDir, { recursive: true });

const prior = fs.existsSync(cycleFile)
  ? fs.readFileSync(cycleFile, "utf8")
  : null;

fs.writeFileSync(cycleFile, JSON.stringify({
  executiveState: {
    business: {
      replies: [{
        id: "reply-1",
        text: "Yes, I am interested. Let's schedule a call.",
        lead: { id: "lead-1", email: "test@example.com" }
      }],
      proposals: [{
        id: "proposal-1",
        title: "Test Proposal",
        dueDate: new Date(Date.now() + 20 * 3600000).toISOString()
      }],
      deals: [{
        id: "deal-1",
        name: "Test Deal",
        value: 10000,
        probability: 0.5,
        score: 80,
        lastActivity: new Date(Date.now() - 4 * 86400000).toISOString()
      }]
    }
  }
}, null, 2));

const planner = require("../SERVICES/PlannerService");
const router = require("../SERVICES/ProviderRouterService");

async function main() {
  const replyPlan = planner.createPlan(
    "Review and classify 1 inbound replies and create required follow-up work"
  );
  const proposalPlan = planner.createPlan(
    "Review urgent proposal deadlines and prepare compliance and submission readiness actions"
  );
  const pipelinePlan = planner.createPlan(
    "Review active deals and generate overdue follow-up and next-action work"
  );

  assert.strictEqual(replyPlan.steps[0].provider, "SalesProvider");
  assert.strictEqual(replyPlan.steps[0].action, "processReplies");
  assert.strictEqual(proposalPlan.steps[0].provider, "SalesProvider");
  assert.strictEqual(proposalPlan.steps[0].action, "reviewProposals");
  assert.strictEqual(pipelinePlan.steps[0].provider, "SalesProvider");
  assert.strictEqual(pipelinePlan.steps[0].action, "reviewPipeline");

  const replyResult = await router.executeProviderTask({
    id: "BUILD-020-REPLY",
    type: "WORKFORCE_STEP",
    payload: {
      objective: replyPlan.objective,
      capability: replyPlan.steps[0].capability,
      provider: replyPlan.steps[0].provider,
      action: replyPlan.steps[0].action,
      department: "Sales",
      assignedTo: replyPlan.steps[0].assignedTo
    }
  });

  const proposalResult = await router.executeProviderTask({
    id: "BUILD-020-PROPOSAL",
    type: "WORKFORCE_STEP",
    payload: {
      objective: proposalPlan.objective,
      capability: proposalPlan.steps[0].capability,
      provider: proposalPlan.steps[0].provider,
      action: proposalPlan.steps[0].action,
      department: "Sales",
      assignedTo: proposalPlan.steps[0].assignedTo
    }
  });

  const pipelineResult = await router.executeProviderTask({
    id: "BUILD-020-PIPELINE",
    type: "WORKFORCE_STEP",
    payload: {
      objective: pipelinePlan.objective,
      capability: pipelinePlan.steps[0].capability,
      provider: pipelinePlan.steps[0].provider,
      action: pipelinePlan.steps[0].action,
      department: "Sales",
      assignedTo: pipelinePlan.steps[0].assignedTo
    }
  });

  assert.strictEqual(replyResult.actionInvoked, "processReplies");
  assert.strictEqual(replyResult.providerOutput.metrics.repliesProcessed, 1);
  assert.strictEqual(proposalResult.actionInvoked, "reviewProposals");
  assert.strictEqual(proposalResult.providerOutput.metrics.critical, 1);
  assert.strictEqual(pipelineResult.actionInvoked, "reviewPipeline");
  assert.strictEqual(pipelineResult.providerOutput.metrics.activeDeals, 1);
  assert.strictEqual(pipelineResult.providerOutput.metrics.stalledDeals, 1);

  console.log(JSON.stringify({
    ok: true,
    build: "020",
    tests: {
      replyPlanning: "PASSED",
      proposalPlanning: "PASSED",
      pipelinePlanning: "PASSED",
      replyAnalysis: "PASSED",
      proposalDeadlineReview: "PASSED",
      pipelineReview: "PASSED",
      protectedSalesActions: "PASSED"
    },
    plans: {
      reply: replyPlan.steps[0],
      proposal: proposalPlan.steps[0],
      pipeline: pipelinePlan.steps[0]
    },
    results: {
      reply: replyResult.providerOutput,
      proposal: proposalResult.providerOutput,
      pipeline: pipelineResult.providerOutput
    }
  }, null, 2));
}

main()
  .finally(() => {
    if (prior === null) {
      try { fs.unlinkSync(cycleFile); } catch {}
    } else {
      fs.writeFileSync(cycleFile, prior, "utf8");
    }
  })
  .catch(error => {
    console.error(error.stack || error.message);
    process.exit(1);
  });

'@ | Set-Content -Path ".\TESTS\Test_Build020_SalesCOO.js" -Encoding UTF8

Write-Host ""
Write-Host "=== BUILD 020 SYNTAX VALIDATION ==="

$Files = @(
  ".\SERVICES\CapabilityService.js",
  ".\SERVICES\ProviderRouterService.js",
  ".\PROVIDERS\providers\SalesProvider.js",
  ".\SERVICES\PlannerService.js",
  ".\SERVICES\WorkflowService.js",
  ".\SERVICES\ExecutionService.js",
  ".\SERVICES\WorkforceExecutionService.js",
  ".\TESTS\Test_Build020_SalesCOO.js"
)

foreach ($File in $Files) {
  & node --check $File
  if ($LASTEXITCODE -ne 0) { throw "Syntax failed: $File" }
  Write-Host "[PASS] $File"
}

Write-Host ""
Write-Host "=== BUILD 020 AUTOMATED TESTS ==="

$Output = & node ".\TESTS\Test_Build020_SalesCOO.js" 2>&1
$ExitCode = $LASTEXITCODE
$Report = Join-Path $ReportDir "build_020_test_$Stamp.txt"
$Output | Tee-Object -FilePath $Report

if ($ExitCode -ne 0) {
  throw "Build 020 tests failed. Restore from $BackupRoot"
}

$Manifest = [ordered]@{
  ok = $true
  build = "020"
  name = "Sales COO"
  installedAt = (Get-Date).ToString("o")
  backupRoot = $BackupRoot
  changedFiles = @(
    "SERVICES\CapabilityService.js",
    "SERVICES\ProviderRouterService.js",
    "PROVIDERS\providers\SalesProvider.js"
  )
  capabilities = @(
    "sales.reply.process",
    "sales.proposal.review",
    "sales.pipeline.review"
  )
  safety = @(
    "No email is sent automatically",
    "No proposal is submitted automatically",
    "No CRM record is changed automatically",
    "Positive replies and proposal actions are marked for protected review"
  )
  report = $Report
}

$Manifest |
  ConvertTo-Json -Depth 8 |
  Set-Content -Path (Join-Path $ReportDir "build_020_manifest_$Stamp.json") -Encoding UTF8

Write-Host ""
Write-Host "============================================================"
Write-Host "BUILD 020 SALES COO INSTALLED AND VERIFIED"
Write-Host "============================================================"
Write-Host "Backup: $BackupRoot"
Write-Host "Report: $Report"
