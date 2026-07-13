# INSTALL_MILES_BUILD_032_OBJECTIVE_PROVIDER_ACTIVATION.ps1
# Complete replacement of SERVICES\CapabilityService.js.
# Maps recurring executive objectives directly to registered providers.

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
    Join-Path $Root "_BACKUPS\BUILD_032_$Stamp"

$ReportDir =
    Join-Path $Root "DATA\build_032"

$TestDir =
    Join-Path $Root "TESTS"

$Target =
    "SERVICES\CapabilityService.js"

$TargetPath =
    Join-Path $Root $Target

New-Item -ItemType Directory `
    -Path $BackupRoot `
    -Force | Out-Null

New-Item -ItemType Directory `
    -Path $ReportDir `
    -Force | Out-Null

New-Item -ItemType Directory `
    -Path $TestDir `
    -Force | Out-Null

if (-not (Test-Path $TargetPath)) {
    throw "Missing authoritative capability service: $TargetPath"
}

$BackupPath =
    Join-Path $BackupRoot $Target

New-Item -ItemType Directory `
    -Path (
      Split-Path `
        $BackupPath `
        -Parent
    ) `
    -Force | Out-Null

Copy-Item `
    $TargetPath `
    $BackupPath `
    -Force

Write-Host ""
Write-Host "============================================================"
Write-Host "MILES BUILD 032"
Write-Host "Executive Objective to Provider Activation"
Write-Host "Complete replacement: SERVICES\CapabilityService.js"
Write-Host "============================================================"
Write-Host "[BACKUP] $Target"

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
  "marketing.segment.replenish": [
    "SYNC_CAMPAIGNS",
    "MANAGE_MARKETING",
    "CREATE_PLAN"
  ],
  "revenue.outbound.audit": [
    "CHECK_DELIVERABILITY",
    "SYNC_CAMPAIGNS",
    "MANAGE_MARKETING",
    "CREATE_PLAN"
  ],
  "sales.pipeline.followup": [
    "CREATE_PLAN",
    "PRIORITIZE_WORK",
    "GENERATE_RECOMMENDATION"
  ],
  "orion.refresh": [
    "QUERY_ORION",
    "RUN_HEALTH_CHECK",
    "SCORE_CONTRACTOR",
    "SCORE_OPPORTUNITY"
  ],
  "government.data.refresh.monitor": [
    "QUERY_ORION",
    "RUN_HEALTH_CHECK",
    "CREATE_PLAN"
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
    expectedOutput:
      "Verified website health, availability, content signals, and repair evidence.",
    verification:
      "Verify WebsiteProvider executed verifyWebsite and returned provider evidence without a provider load failure."
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
    expectedOutput:
      "Current website health report with metrics, exceptions, and recommendations.",
    verification:
      "Verify the website audit produced current metrics and provider evidence."
  },
  {
    capability: "sales.pipeline.followup",
    provider: "SalesProvider",
    providerKey: "crm",
    department: "Sales",
    workforce: "Sales Operations Workforce",
    action: "reviewPipeline",
    authorityOperation: "READ_PIPELINE",
    taskType: "WORKFORCE_STEP",
    priority: 95,
    patterns: [
      /\bstalled\s+(deal|deals|opportunit|opportunities)\b/i,
      /\bnext[-\s]?action\s+recommendations?\b.*\b(deal|sales|pipeline)\b/i,
      /\b(review|inspect|analyze)\b.*\b(stalled|overdue)\b.*\b(deal|pipeline|follow[-\s]?up)\b/i,
      /\bbuild\s+sales\s+coo\s+pipeline\b/i,
      /\bsales\s+pipeline\b.*\b(follow[-\s]?up|operator|review|stalled|next action)\b/i,
      /\brecurring\s+follow[-\s]?up\s+queue\b/i
    ],
    expectedOutput:
      "Current pipeline value, stalled deals, overdue follow-up recommendations, and prioritized next actions.",
    verification:
      "Verify SalesProvider executed reviewPipeline and returned pipeline evidence and next-action recommendations."
  },
  {
    capability: "marketing.segment.replenish",
    provider: "MarketingProvider",
    providerKey: "instantly",
    department: "Marketing",
    workforce: "Marketing Operations Workforce",
    action: "refresh",
    authorityOperation: "LIST_CAMPAIGNS",
    taskType: "WORKFORCE_STEP",
    priority: 95,
    patterns: [
      /\breplenish\b.*\bsegment|segments\b/i,
      /\bdepleted\s+segment|segments\b/i,
      /\bidentify\b.*\bdepleted\s+outreach\s+segment|segments\b/i,
      /\bsegment\b.*\b(enrich|enrichment|replenish|depleted|empty)\b/i,
      /\b(enrich|enrichment|replenish)\b.*\bsegment|segments\b/i,
      /\bverified\s+lead\b.*\b(replenish|match|prepare|upload)\b/i
    ],
    expectedOutput:
      "Segment depletion assessment, campaign demand, verified-lead readiness, and enrichment or replenishment recommendations.",
    verification:
      "Verify MarketingProvider refreshed segment and campaign state and returned actionable replenishment evidence."
  },
  {
    capability: "revenue.outbound.audit",
    provider: "MarketingProvider",
    providerKey: "instantly",
    department: "Revenue Operations",
    workforce: "Marketing Operations Workforce",
    action: "refresh",
    authorityOperation: "LIST_CAMPAIGNS",
    taskType: "WORKFORCE_STEP",
    priority: 90,
    patterns: [
      /\bown\s+instantly\b/i,
      /\bown\s+outbound\b/i,
      /\bexpand\s+outbound\b/i,
      /\boutbound\s+capacity\b/i,
      /\bemail\s+infrastructure\b/i,
      /\bmailbox\b.*\bcampaign\b/i,
      /\bcampaign\b.*\b(mailbox|capacity|segment|verified lead)\b/i,
      /\bbooked\s+meetings\b.*\b(outbound|campaign|instantly)\b/i
    ],
    expectedOutput:
      "Current outbound operating state, campaign and inbox capacity, segment readiness, deliverability risks, and required actions.",
    verification:
      "Verify MarketingProvider returned current outbound metrics, exceptions, and actionable recommendations."
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
    expectedOutput:
      "Current Instantly campaign health, active/paused campaign counts, exceptions, and recommendations.",
    verification:
      "Verify MarketingProvider returned current campaign metrics and no unhandled provider failure."
  },
  {
    capability: "government.data.refresh.monitor",
    provider: "OrionProvider",
    providerKey: "orion",
    department: "ORION",
    workforce: "ORION Data Operations Workforce",
    action: "refresh",
    authorityOperation: "VERIFY_DATABASE",
    taskType: "WORKFORCE_STEP",
    priority: 90,
    patterns: [
      /\bbuild\s+government\s+data\s+coo\s+refresh\s+monitor\b/i,
      /\badd\s+source\s+monitors?\b.*\b(sam|gsa|va|forecast|rfi|sources sought)\b/i,
      /\bgovernment\s+data\b.*\bmonitor|monitoring|source|sources\b/i,
      /\b(sam|gsa|va|forecast|rfi|sources sought)\b.*\b(refresh|monitor|sync)\b/i
    ],
    expectedOutput:
      "Refreshed government-data source state, database freshness, exceptions, and source-monitor recommendations.",
    verification:
      "Verify OrionProvider completed refresh and returned source and database evidence."
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
    expectedOutput:
      "Refreshed ORION provider state, metrics, exceptions, and recommendations.",
    verification:
      "Verify OrionProvider completed refresh and returned provider evidence."
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
  expectedOutput:
    "Clear interpretation of the work objective.",
  verification:
    "Verify the objective is actionable and aligned to P2GC operating priorities."
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

    executiveState.update(
      "workforce",
      workforce.status()
    );

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
        ENTERPRISE_CAPABILITY_NAMES[
          entry.capability
        ] || [],
      taskType: entry.taskType,
      priority: entry.priority,
      expectedOutput: entry.expectedOutput,
      verification: entry.verification
    }));
  }

  findWorkers(capability) {
    return workforce.findByCapability(
      capability
    );
  }

  getCapability(capability) {
    const key =
      String(capability || "")
        .trim()
        .toLowerCase();

    return CAPABILITY_REGISTRY.find(
      entry =>
        entry.capability
          .toLowerCase() === key
    ) || null;
  }

  enterpriseResolution(capability) {
    const names =
      ENTERPRISE_CAPABILITY_NAMES[
        capability
      ] || [];

    const attempts = [];

    for (const name of names) {
      try {
        const result =
          this.enterpriseRegistry
            .resolve(name);

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
          status:
            "ENTERPRISE_RESOLUTION_ERROR",
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

  authorityResolution(
    providerKey,
    operation
  ) {
    const authorityRegistry =
      safeRun(providerAuthority);

    const bindingRegistry =
      safeRun(providerBindings);

    const provider =
      (authorityRegistry.providers || [])
        .find(
          item =>
            item.key === providerKey
        );

    const binding =
      bindingRegistry
        .bindings?.[providerKey] ||
      null;

    const operationBinding =
      binding?.operations?.[operation] ||
      null;

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

  resolveObjective(
    objective,
    context = {}
  ) {
    let resolved = null;

    if (context.capability) {
      const explicit =
        this.getCapability(
          context.capability
        );

      if (explicit) {
        resolved = {
          ...clone(explicit),
          provider:
            context.provider ||
            explicit.provider,
          department:
            context.department ||
            explicit.department,
          action:
            context.action ||
            explicit.action,
          resolution:
            "EXPLICIT_CAPABILITY"
        };
      }
    }

    if (!resolved) {
      const text =
        normalizeText(
          objective,
          context
        );

      for (
        const entry
        of CAPABILITY_REGISTRY
      ) {
        if (
          entry.patterns.some(
            pattern =>
              pattern.test(text)
          )
        ) {
          resolved =
            clone(entry);

          delete resolved.patterns;

          resolved = {
            ...resolved,
            provider:
              context.provider ||
              resolved.provider,
            department:
              context.department ||
              resolved.department,
            action:
              context.action ||
              resolved.action,
            resolution:
              "OBJECTIVE_MATCH"
          };

          break;
        }
      }
    }

    if (!resolved) {
      resolved = {
        ...clone(
          EXECUTIVE_FALLBACK
        ),
        provider:
          context.provider ||
          null,
        department:
          context.department ||
          EXECUTIVE_FALLBACK
            .department,
        action:
          context.action ||
          EXECUTIVE_FALLBACK
            .action,
        resolution:
          "EXECUTIVE_FALLBACK"
      };
    }

    const enterprise =
      this.enterpriseResolution(
        resolved.capability
      );

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

  planObjective(
    objective,
    context = {}
  ) {
    const resolved =
      this.resolveObjective(
        objective,
        context
      );

    const preferred =
      workforce.resolvePreferredWorker(
        resolved.enterprise
          ?.result
          ?.preferredProvider ||
          null,
        resolved.capability
      );

    const candidateGroups =
      this.findWorkers(
        resolved.capability
      );

    const bestWorker =
      preferred.worker ||
      null;

    const assignedTo =
      context.assignedTo ||
      bestWorker?.employee ||
      "MILES";

    const step = {
      step: 1,
      capability:
        resolved.capability,
      provider:
        resolved.provider,
      department:
        resolved.department,
      action:
        resolved.action,
      taskType:
        resolved.taskType ||
        "WORKFORCE_STEP",
      assignedTo,
      status: "QUEUED",
      dependsOn: [],
      expectedOutput:
        resolved.expectedOutput,
      verification:
        resolved.verification,
      registryMetadata: {
        registryResolution:
          resolved.registryResolution,
        enterpriseCapability:
          resolved.enterprise
            ?.selectedCapability ||
          null,
        enterprisePreferredComponent:
          resolved.enterprise
            ?.result
            ?.preferredProvider ||
          null,
        workerAssignmentSource:
          preferred.source,
        providerAuthorityStatus:
          resolved.authority
            ?.provider
            ?.status ||
          null,
        providerSafeMode:
          resolved.authority
            ?.provider
            ?.safeMode ??
          null,
        operationAuthorized:
          resolved.authority
            ?.operationBinding
            ?.authorized ??
          null,
        missingCredentials:
          resolved.authority
            ?.provider
            ?.credentials
            ?.missingEnv ||
          []
      }
    };

    return {
      ok: true,
      objective,
      domain:
        String(
          resolved.department ||
          "Executive"
        ).toLowerCase(),
      workforce:
        resolved.workforce,
      resolution:
        resolved.resolution,
      registryResolution:
        resolved.registryResolution,
      enterpriseResolution:
        resolved.enterprise,
      authorityResolution:
        resolved.authority,
      workerResolution:
        preferred,
      requiredCapabilities: [
        resolved.capability
      ],
      assignments: [{
        capability:
          resolved.capability,
        provider:
          resolved.provider,
        department:
          resolved.department,
        action:
          resolved.action,
        bestWorker:
          bestWorker || null,
        candidates:
          candidateGroups
      }],
      operationalPlan: {
        domain:
          String(
            resolved.department ||
            "Executive"
          ).toLowerCase(),
        workforce:
          resolved.workforce,
        providers:
          resolved.provider
            ? [resolved.provider]
            : [],
        approvalRequired:
          false,
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

module.exports =
  new CapabilityService();

'@ | Set-Content `
    -Path $TargetPath `
    -Encoding UTF8

$TestPath =
    Join-Path `
      $TestDir `
      "Test_Build032_ObjectiveProviderActivation.js"

@'
"use strict";

const assert =
  require("assert");

const capabilityService =
  require(
    "../SERVICES/CapabilityService"
  );

function stepFor(objective) {
  const plan =
    capabilityService
      .planObjective(objective);

  return {
    plan,
    step:
      plan.operationalPlan
        .steps[0]
  };
}

function main() {
  const sales =
    stepFor(
      "Build Sales COO pipeline and follow-up operator"
    );

  assert.strictEqual(
    sales.step.capability,
    "sales.pipeline.followup"
  );
  assert.strictEqual(
    sales.step.provider,
    "SalesProvider"
  );
  assert.strictEqual(
    sales.step.action,
    "reviewPipeline"
  );

  const stalled =
    stepFor(
      "Review stalled sales opportunities and create follow-up recommendations"
    );

  assert.strictEqual(
    stalled.step.provider,
    "SalesProvider"
  );
  assert.strictEqual(
    stalled.step.action,
    "reviewPipeline"
  );

  const segments =
    stepFor(
      "Identify depleted outreach segments and create enrichment work"
    );

  assert.strictEqual(
    segments.step.capability,
    "marketing.segment.replenish"
  );
  assert.strictEqual(
    segments.step.provider,
    "MarketingProvider"
  );
  assert.strictEqual(
    segments.step.action,
    "refresh"
  );

  const government =
    stepFor(
      "Add source monitors for SAM, GSA, VA, forecasts, RFIs, and Sources Sought."
    );

  assert.strictEqual(
    government.step.capability,
    "government.data.refresh.monitor"
  );
  assert.strictEqual(
    government.step.provider,
    "OrionProvider"
  );
  assert.strictEqual(
    government.step.action,
    "refresh"
  );

  const outbound =
    stepFor(
      "Own Instantly and expand outbound capacity using campaigns, mailboxes, segments, and verified leads."
    );

console.log("===== OUTBOUND PLAN =====");
console.log(JSON.stringify(outbound, null, 2));
console.log("STEP CAPABILITY:", outbound.step.capability);
console.log("=========================");

assert.strictEqual(
    outbound.step.capability,
    "revenue.outbound.audit"
);

assert.strictEqual(
    outbound.step.provider,
    "MarketingProvider"
);

  const unknown =
    stepFor(
      "Prepare an unrelated executive matter"
    );

  assert.strictEqual(
    unknown.step.capability,
    "executive.objective.evaluate"
  );

  console.log(JSON.stringify({
    ok: true,
    build: "032",
    tests: {
      salesPipelineProviderRouting:
        "PASSED",
      stalledDealProviderRouting:
        "PASSED",
      depletedSegmentProviderRouting:
        "PASSED",
      governmentDataProviderRouting:
        "PASSED",
      outboundProviderRouting:
        "PASSED",
      executiveFallbackPreserved:
        "PASSED"
    },
    plans: {
      sales: sales.plan,
      stalled: stalled.plan,
      segments: segments.plan,
      government: government.plan,
      outbound: outbound.plan,
      unknown: unknown.plan
    }
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(
    error.stack ||
    error.message
  );
  process.exit(1);
}

'@ | Set-Content `
    -Path $TestPath `
    -Encoding UTF8

Write-Host ""
Write-Host "=== BUILD 032 SYNTAX VALIDATION ==="

$Files = @(
    ".\SERVICES\CapabilityService.js",
    ".\SERVICES\PlannerService.js",
    ".\SERVICES\WorkflowService.js",
    ".\SERVICES\ProviderRouterService.js",
    ".\PROVIDERS\providers\MarketingProvider.js",
    ".\PROVIDERS\providers\SalesProvider.js",
    ".\PROVIDERS\providers\OrionProvider.js",
    ".\TESTS\Test_Build032_ObjectiveProviderActivation.js"
)

foreach ($File in $Files) {
    if (-not (Test-Path $File)) {
        throw "Required file missing: $File"
    }

    & node --check $File

    if ($LASTEXITCODE -ne 0) {
        throw "Syntax failed: $File"
    }

    Write-Host "[PASS] $File"
}

Write-Host ""
Write-Host "=== BUILD 032 AUTOMATED TESTS ==="

$Output =
    & node $TestPath 2>&1

$ExitCode =
    $LASTEXITCODE

$Report =
    Join-Path `
      $ReportDir `
      "build_032_test_$Stamp.txt"

$Output |
    Tee-Object -FilePath $Report

if ($ExitCode -ne 0) {
    throw "Build 032 tests failed. Restore from $BackupRoot"
}

Write-Host ""
Write-Host "============================================================"
Write-Host "BUILD 032 OBJECTIVE PROVIDER ACTIVATION INSTALLED AND VERIFIED"
Write-Host "============================================================"
Write-Host "Backup: $BackupRoot"
Write-Host "Report: $Report"
Write-Host ""
Write-Host "Restart production:"
Write-Host "taskkill /F /IM node.exe"
Write-Host "node StartMilesProduction.js"
