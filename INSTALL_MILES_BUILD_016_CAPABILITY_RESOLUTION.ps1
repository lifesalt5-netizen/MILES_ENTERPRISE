# INSTALL_MILES_BUILD_016_CAPABILITY_RESOLUTION.ps1
# Authoritative Build 016 replacement installer
# Scope: CapabilityService, PlannerService, ProviderRouterService, WebsiteProvider
# Preserves the existing WorkflowService, ExecutionService, WorkforceExecutionService,
# WorkPackageService, queue, governance, and verification architecture.

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Root = "D:\P2GC_Intelligence\MILES_ENTERPRISE"
if (-not (Test-Path $Root)) {
    throw "Authoritative MILES root not found: $Root"
}

Set-Location $Root
$env:MILES_ROOT = $Root

$Stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$BackupRoot = Join-Path $Root "_BACKUPS\BUILD_016_$Stamp"
$TestDir = Join-Path $Root "TESTS"
$ReportDir = Join-Path $Root "DATA\build_016"

New-Item -ItemType Directory -Path $BackupRoot -Force | Out-Null
New-Item -ItemType Directory -Path $TestDir -Force | Out-Null
New-Item -ItemType Directory -Path $ReportDir -Force | Out-Null

$Targets = @(
    "SERVICES\CapabilityService.js",
    "SERVICES\PlannerService.js",
    "SERVICES\ProviderRouterService.js",
    "PROVIDERS\providers\WebsiteProvider.js"
)

Write-Host ""
Write-Host "============================================================"
Write-Host "MILES BUILD 016 - CAPABILITY RESOLUTION"
Write-Host "Root:   $Root"
Write-Host "Backup: $BackupRoot"
Write-Host "============================================================"

foreach ($RelativePath in $Targets) {
    $Source = Join-Path $Root $RelativePath
    if (-not (Test-Path $Source)) {
        throw "Required authoritative file not found: $Source"
    }

    $BackupPath = Join-Path $BackupRoot $RelativePath
    New-Item -ItemType Directory -Path (Split-Path $BackupPath -Parent) -Force | Out-Null
    Copy-Item $Source $BackupPath -Force
    Write-Host "[BACKUP] $RelativePath"
}

@'
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
'@ | Set-Content -Path (Join-Path $Root "SERVICES\CapabilityService.js") -Encoding UTF8

@'
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
'@ | Set-Content -Path (Join-Path $Root "SERVICES\PlannerService.js") -Encoding UTF8

@'
"use strict";

const MarketingProvider = require("../PROVIDERS/providers/MarketingProvider");
const OrionProvider = require("../PROVIDERS/providers/OrionProvider");
const WebsiteProvider = require("../PROVIDERS/providers/WebsiteProvider");

class ProviderRouterService {
  constructor() {
    this.providers = {
      MarketingProvider,
      OrionProvider,
      WebsiteProvider
    };

    this.aliases = {
      marketing: "MarketingProvider",
      marketingprovider: "MarketingProvider",
      instantly: "MarketingProvider",
      instantlyprovider: "MarketingProvider",
      linkedin: "MarketingProvider",
      millionverifier: "MarketingProvider",

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
  }

  normalizeProviderName(providerName = "") {
    const raw = String(providerName || "").trim();
    if (!raw) return null;

    const key = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
    return this.aliases[key] || raw;
  }

  hasProvider(providerName = "") {
    const normalized = this.normalizeProviderName(providerName);
    return Boolean(normalized && this.providers[normalized]);
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
    const providerName = this.normalizeProviderName(requestedProvider);

    if (!providerName) {
      return this.noProviderResult(task, "No provider was specified for this task.");
    }

    const ProviderClass = this.providers[providerName];

    if (!ProviderClass) {
      return this.noProviderResult(
        task,
        `Provider is not registered: ${providerName}`
      );
    }

    const startedAt = new Date().toISOString();

    try {
      const provider = new ProviderClass();
      const requestedAction = payload.action || "refresh";
      const providerOutput = await this.invokeProvider(
        provider,
        requestedAction,
        task
      );
      const completedAt = new Date().toISOString();

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
        dataFreshness: provider.dataFreshness || "Unknown",
        lastRefresh: provider.lastRefresh || completedAt,
        metrics: provider.metrics || {},
        exceptions: provider.exceptions || [],
        recommendations: provider.recommendations || [],
        providerOutput,
        evidence: {
          providerLoaded: true,
          initialized: true,
          requestedProvider,
          routedProvider: providerName,
          requestedAction,
          actionAvailable:
            typeof provider[requestedAction] === "function",
          metricsCaptured: Boolean(provider.metrics),
          exceptionsCaptured: Array.isArray(provider.exceptions),
          recommendationsCaptured: Array.isArray(provider.recommendations)
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
        action: payload.action || "refresh",
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
          `Verify provider action and connector configuration for ${providerName}.`
        ],
        evidence: {
          providerLoaded: true,
          initialized: false,
          requestedProvider,
          routedProvider: providerName,
          requestedAction: payload.action || null,
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
    return {
      ok: true,
      registeredProviders: Object.keys(this.providers),
      aliases: this.aliases
    };
  }
}

module.exports = new ProviderRouterService();
'@ | Set-Content -Path (Join-Path $Root "SERVICES\ProviderRouterService.js") -Encoding UTF8

@'
"use strict";

const IDataProvider = require("../contracts/IDataProvider");
const website = require("../../CONNECTORS/WEBSITE/website");

class WebsiteProvider extends IDataProvider {
  constructor() {
    super("Website");

    this.dependencies = ["Website"];
    this.sourceSystems = ["CONNECTORS/WEBSITE"];
  }

  async initialize() {
    return this.verifyWebsite();
  }

  async refresh() {
    return this.verifyWebsite();
  }

  async verifyWebsite() {
    this.lastRefresh = new Date().toISOString();
    this.dataFreshness = "Live";

    try {
      const result = await website.auditWebsite();

      this.status = result.ok ? "Healthy" : "Critical";
      this.metrics = result.metrics || {};
      this.exceptions = result.ok
        ? []
        : [{
            type: "WebsiteUnavailable",
            severity: "Critical",
            message: result.error || "Website audit failed."
          }];

      this.recommendations = result.ok
        ? []
        : [
            "Verify B12 website availability.",
            "Verify DNS.",
            "Verify SSL."
          ];

      return {
        ok: Boolean(result.ok),
        provider: "WebsiteProvider",
        action: "verifyWebsite",
        status: this.status,
        metrics: this.metrics,
        exceptions: this.exceptions,
        recommendations: this.recommendations,
        verifiedAt: this.lastRefresh
      };
    } catch (err) {
      this.status = "Critical";
      this.metrics = {};
      this.exceptions = [{
        type: "WebsiteAudit",
        severity: "Critical",
        message: err.stack || err.message
      }];
      this.recommendations = [
        "Verify Website connector.",
        "Verify P2GC_WEBSITE_URL.",
        "Verify outbound HTTPS access."
      ];

      return {
        ok: false,
        provider: "WebsiteProvider",
        action: "verifyWebsite",
        status: this.status,
        metrics: this.metrics,
        exceptions: this.exceptions,
        recommendations: this.recommendations,
        verifiedAt: this.lastRefresh
      };
    }
  }

  async executeTask(task = {}) {
    const payload = task.payload || task || {};
    const action = payload.action || "verifyWebsite";

    if (typeof this[action] !== "function") {
      throw new Error(`Unsupported WebsiteProvider action: ${action}`);
    }

    return this[action](task);
  }

  async shutdown() {
    return true;
  }
}

module.exports = WebsiteProvider;
'@ | Set-Content -Path (Join-Path $Root "PROVIDERS\providers\WebsiteProvider.js") -Encoding UTF8

@'
"use strict";

const assert = require("assert");
const capabilityService = require("../SERVICES/CapabilityService");
const planner = require("../SERVICES/PlannerService");
const providerRouter = require("../SERVICES/ProviderRouterService");

async function main() {
  const websiteResolution = capabilityService.resolveObjective(
    "Repair Website: WebsiteProviderLoadFailure"
  );

  assert.strictEqual(websiteResolution.provider, "WebsiteProvider");
  assert.strictEqual(websiteResolution.department, "Website");
  assert.strictEqual(websiteResolution.capability, "website.health.repair");
  assert.strictEqual(websiteResolution.action, "verifyWebsite");

  const criticalResolution = capabilityService.resolveObjective(
    "Critical exception: WebsiteProviderLoadFailure"
  );

  assert.strictEqual(criticalResolution.provider, "WebsiteProvider");
  assert.strictEqual(criticalResolution.department, "Website");
  assert.strictEqual(criticalResolution.capability, "website.health.repair");
  assert.strictEqual(criticalResolution.action, "verifyWebsite");

  const instantlyResolution = capabilityService.resolveObjective(
    "Audit Instantly campaign health"
  );

  assert.strictEqual(instantlyResolution.provider, "MarketingProvider");
  assert.strictEqual(instantlyResolution.capability, "marketing.campaign.audit");

  const orionResolution = capabilityService.resolveObjective(
    "Refresh ORION data"
  );

  assert.strictEqual(orionResolution.provider, "OrionProvider");
  assert.strictEqual(orionResolution.capability, "orion.refresh");

  const plan = planner.createPlan(
    "Repair Website: WebsiteProviderLoadFailure"
  );

  assert.strictEqual(plan.steps.length, 1);
  assert.strictEqual(plan.steps[0].provider, "WebsiteProvider");
  assert.strictEqual(plan.steps[0].department, "Website");
  assert.strictEqual(plan.steps[0].capability, "website.health.repair");
  assert.strictEqual(plan.steps[0].action, "verifyWebsite");
  assert.strictEqual(plan.steps[0].taskType, "WORKFORCE_STEP");
  assert.strictEqual(plan.approvalRequired, false);

  const routerStatus = providerRouter.status();
  assert(routerStatus.registeredProviders.includes("WebsiteProvider"));
  assert(routerStatus.registeredProviders.includes("MarketingProvider"));
  assert(routerStatus.registeredProviders.includes("OrionProvider"));
  assert.strictEqual(
    providerRouter.normalizeProviderName("website"),
    "WebsiteProvider"
  );
  assert.strictEqual(
    providerRouter.normalizeProviderName("b12"),
    "WebsiteProvider"
  );

  const providerResult = await providerRouter.executeProviderTask({
    id: "BUILD-016-TEST",
    type: "WORKFORCE_STEP",
    payload: {
      workPackageId: "BUILD-016-WP",
      objective: "Repair Website: WebsiteProviderLoadFailure",
      provider: "WebsiteProvider",
      department: "Website",
      capability: "website.health.repair",
      action: "verifyWebsite",
      assignedTo: "MILES"
    }
  });

  assert.strictEqual(providerResult.provider, "WebsiteProvider");
  assert.strictEqual(providerResult.routedTo, "WebsiteProvider");
  assert.strictEqual(providerResult.action, "verifyWebsite");
  assert.strictEqual(providerResult.actionInvoked, "verifyWebsite");
  assert.strictEqual(
    providerResult.evidence.actionAvailable,
    true
  );
  assert.notStrictEqual(providerResult.type, "NO_PROVIDER_RESULT");

  console.log(JSON.stringify({
    ok: true,
    build: "016",
    tests: {
      capabilityResolution: "PASSED",
      plannerResolution: "PASSED",
      providerRegistration: "PASSED",
      providerActionDispatch: "PASSED"
    },
    websiteResolution,
    planStep: plan.steps[0],
    routerStatus,
    providerResult
  }, null, 2));
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exit(1);
});
'@ | Set-Content -Path (Join-Path $TestDir "Test_Build016_CapabilityResolution.js") -Encoding UTF8

$SyntaxFiles = @(
    ".\SERVICES\CapabilityService.js",
    ".\SERVICES\PlannerService.js",
    ".\SERVICES\ProviderRouterService.js",
    ".\PROVIDERS\providers\WebsiteProvider.js",
    ".\TESTS\Test_Build016_CapabilityResolution.js"
)

Write-Host ""
Write-Host "=== SYNTAX VALIDATION ==="
foreach ($File in $SyntaxFiles) {
    & node --check $File
    if ($LASTEXITCODE -ne 0) {
        throw "Syntax validation failed: $File"
    }
    Write-Host "[PASS] $File"
}

Write-Host ""
Write-Host "=== AUTOMATED BUILD 016 TESTS ==="
$TestOutput = & node ".\TESTS\Test_Build016_CapabilityResolution.js" 2>&1
$TestExit = $LASTEXITCODE
$TestOutput | Tee-Object -FilePath (Join-Path $ReportDir "build_016_test_output_$Stamp.txt")

if ($TestExit -ne 0) {
    throw "Build 016 automated tests failed. Backups are available at $BackupRoot"
}

$Verification = & node -e @'
const planner = require("./SERVICES/PlannerService");
const router = require("./SERVICES/ProviderRouterService");
const plan = planner.createPlan("Repair Website: WebsiteProviderLoadFailure");
console.log(JSON.stringify({
  ok: true,
  objective: plan.objective,
  resolution: plan.resolution,
  step: plan.steps[0],
  registeredProviders: router.status().registeredProviders
}, null, 2));
'@ 2>&1

$Verification | Tee-Object -FilePath (Join-Path $ReportDir "build_016_planner_verification_$Stamp.json")

$Manifest = [ordered]@{
    ok = $true
    build = "016"
    installedAt = (Get-Date).ToString("o")
    root = $Root
    backupRoot = $BackupRoot
    replacedFiles = $Targets
    preservedServices = @(
        "SERVICES\WorkflowService.js",
        "SERVICES\WorkPackageService.js",
        "SERVICES\ExecutionService.js",
        "SERVICES\WorkforceExecutionService.js",
        "CORE\TaskQueue.js"
    )
    testFile = "TESTS\Test_Build016_CapabilityResolution.js"
    expectedWebsitePlan = [ordered]@{
        provider = "WebsiteProvider"
        department = "Website"
        capability = "website.health.repair"
        action = "verifyWebsite"
        taskType = "WORKFORCE_STEP"
    }
}

$Manifest |
    ConvertTo-Json -Depth 8 |
    Set-Content -Path (Join-Path $ReportDir "build_016_manifest_$Stamp.json") -Encoding UTF8

Write-Host ""
Write-Host "============================================================"
Write-Host "BUILD 016 INSTALLED AND VERIFIED"
Write-Host "============================================================"
Write-Host "Backups: $BackupRoot"
Write-Host "Reports: $ReportDir"
Write-Host ""
Write-Host "Expected planning result:"
Write-Host "  provider   = WebsiteProvider"
Write-Host "  department = Website"
Write-Host "  capability = website.health.repair"
Write-Host "  action     = verifyWebsite"
Write-Host ""
Write-Host "Next production verification command:"
Write-Host 'node -e "const w=require(''./SERVICES/WorkflowService''); console.log(JSON.stringify(w.createWorkflow(''Repair Website: WebsiteProviderLoadFailure''),null,2));"'
Write-Host ""
Write-Host "Then execute the newly queued task:"
Write-Host 'node -e "const e=require(''./SERVICES/ExecutionService''); e.runNext().then(r=>console.log(JSON.stringify(r,null,2))).catch(e=>{console.error(e);process.exit(1);});"'
