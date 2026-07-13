# INSTALL_MILES_BUILD_029_EXECUTIVE_INTENT_BRIDGE.ps1
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Root = "D:\P2GC_Intelligence\MILES_ENTERPRISE"

if (-not (Test-Path $Root)) {
    throw "MILES root not found: $Root"
}

Set-Location $Root
$env:MILES_ROOT = $Root

$Stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$BackupRoot = Join-Path $Root "_BACKUPS\BUILD_029_$Stamp"
$ReportDir = Join-Path $Root "DATA\build_029"
$TestDir = Join-Path $Root "TESTS"
$Target = "SERVICES\CommandIntentPlannerService.js"
$TargetPath = Join-Path $Root $Target

New-Item -ItemType Directory -Path $BackupRoot -Force | Out-Null
New-Item -ItemType Directory -Path $ReportDir -Force | Out-Null
New-Item -ItemType Directory -Path $TestDir -Force | Out-Null

if (-not (Test-Path $TargetPath)) {
    throw "Missing authoritative planner: $TargetPath"
}

$BackupPath = Join-Path $BackupRoot $Target
New-Item -ItemType Directory -Path (Split-Path $BackupPath -Parent) -Force | Out-Null
Copy-Item $TargetPath $BackupPath -Force

Write-Host ""
Write-Host "============================================================"
Write-Host "MILES BUILD 029"
Write-Host "Executive Intent Bridge"
Write-Host "Only CommandIntentPlannerService.js will be replaced."
Write-Host "============================================================"
Write-Host "[BACKUP] $Target"

@'
"use strict";

const SUPPORTED_MILES_ACTIONS = new Set([
  "SCAN_PROJECT","STATUS","SMOKE_TEST","ANALYZE_PROJECT","BUILD_PLAN",
  "TEST_RUNTIME","BUILD_CONNECTOR","REPOSITORY_REGISTRY","CAPABILITY_REGISTRY",
  "EXECUTIVE_BRAIN","COMPANY_STATE","TASK_ROUTER","COO_LOOP",
  "EXECUTIVE_DASHBOARD","SELF_LEARNING","ACTION_ENGINE","PROVIDER_CONTROLLERS",
  "PROVIDER_CONTROLLER_HEALTH","PROVIDER_CONTROLLER_EXECUTE","INSTANTLY_LIVE",
  "CONTROLLED_WRITE","BUSINESS_EXECUTION","PROVIDER_AUTHORITY",
  "PROVIDER_INTERFACE_ADAPTERS","PROVIDER_CAPABILITY_BINDINGS","PROVIDER_SYNC",
  "ENGINEERING_IMPROVEMENT","ENGINEERING_ANALYZE","ENGINEERING_PLAN",
  "ENGINEERING_IMPLEMENT","ENGINEERING_VALIDATE","ENGINEERING_REPORT",
  "SELF_MAINTENANCE","SELF_MAINTENANCE_DIAGNOSE","SELF_MAINTENANCE_PLAN",
  "SELF_MAINTENANCE_VALIDATE","SELF_MAINTENANCE_REPORT","WEBSITE_REVIEW"
]);

class CommandIntentPlannerService {
  plan(operation = {}) {
    const raw = String(
      operation.command || operation.action || operation.title || ""
    ).trim();
    const text = raw.toLowerCase();

    const directAction = this.resolveExplicitMilesAction(raw);
    if (directAction) {
      return this.buildPlan({
        raw,
        intent: this.intentForAction(directAction),
        workflow: directAction,
        capability: directAction,
        provider: "MILES",
        connector: "MILES",
        action: directAction,
        steps: [{
          step: 1,
          provider: "MILES",
          connector: "MILES",
          capability: directAction,
          action: directAction,
          objective: raw
        }]
      });
    }

    const intent = this.resolveIntent(text, operation);
    const workflow = this.resolveWorkflow(text, intent, operation);
    const capability = this.resolveCapability(text, intent, workflow, operation);
    const provider = this.resolveProvider(text, intent, workflow, capability, operation);
    const action = this.resolveAction(text, intent, workflow, capability, provider, operation);
    const connector = this.resolveConnector(provider, action, capability, operation);
    const steps = this.resolveSteps(
      text, intent, workflow, capability, provider, connector, action
    );

    return this.buildPlan({
      raw, intent, workflow, capability, provider, connector, action, steps
    });
  }

  buildPlan({ raw, intent, workflow, capability, provider, connector, action, steps }) {
    return {
      ok: true,
      intent,
      workflow,
      capability,
      provider,
      system: provider,
      connector,
      department: this.resolveDepartment(intent, provider),
      action,
      objective: raw,
      originalCommand: raw,
      steps,
      plannedAt: new Date().toISOString()
    };
  }

  resolveExplicitMilesAction(raw) {
    const normalized = String(raw || "")
      .trim()
      .toUpperCase()
      .replace(/^MILES[\s,:-]*/i, "")
      .replace(/^RUN[\s,:-]*/i, "")
      .replace(/[.!?]+$/g, "")
      .trim();

    if (SUPPORTED_MILES_ACTIONS.has(normalized)) return normalized;

    const match = normalized.match(
      /\b(STATUS|INSTANTLY_LIVE|PROVIDER_AUTHORITY|PROVIDER_SYNC|BUSINESS_EXECUTION|CONTROLLED_WRITE|EXECUTIVE_BRAIN|EXECUTIVE_DASHBOARD|COMPANY_STATE|COO_LOOP|SELF_MAINTENANCE|ENGINEERING_ANALYZE|ENGINEERING_PLAN|ENGINEERING_IMPLEMENT|ENGINEERING_VALIDATE|ENGINEERING_REPORT|WEBSITE_REVIEW)\b/
    );

    return match && SUPPORTED_MILES_ACTIONS.has(match[1]) ? match[1] : null;
  }

  intentForAction(action) {
    if (action.startsWith("ENGINEERING_") || action.startsWith("SELF_MAINTENANCE")) {
      return "ENGINEERING";
    }

    if (["INSTANTLY_LIVE","BUSINESS_EXECUTION","CONTROLLED_WRITE"].includes(action)) {
      return "REVENUE_OPERATIONS";
    }

    return "EXECUTIVE_COMMAND";
  }

  resolveIntent(text, operation = {}) {
    if (operation.intent) return String(operation.intent);
    if (this.isRevenueOperationsMission(text)) return "REVENUE_OPERATIONS";

    if (
      /^miles executive directive/i.test(text) ||
      /^miles engineering directive/i.test(text) ||
      /build\s+\d+/i.test(text) ||
      /current planner|command intent planner|replace keyword routing|hierarchical intent/.test(text) ||
      /execution layer|execution service|dispatch|dispatcher/.test(text) ||
      /repository search|code writer|runtime diagnostic|runtime trace|diagnostic harness/.test(text) ||
      /improve miles|fix miles|repair miles|maintain miles|upgrade miles/.test(text) ||
      /self improve|self maintenance|autonomous improvement|engineering improvement/.test(text)
    ) return "ENGINEERING";

    if (
      /executive integration audit|integration audit|audit.*pipeline|verify.*pipeline/.test(text) ||
      /full ceo command pipeline|wire existing services/.test(text)
    ) return "EXECUTIVE_AUDIT";

    if (/check orion|orion health|orion system health|check.*orion.*health/.test(text)) {
      return "CONNECTOR_OPERATION";
    }

    if (/review website|website review|check website|website health/.test(text)) {
      return "BUSINESS_OPERATION";
    }

    if (/review instantly|instantly health|deliverability|bounce|campaign/.test(text)) {
      return "BUSINESS_OPERATION";
    }

    if (/google workspace|gmail|calendar|google drive/.test(text)) {
      return "BUSINESS_OPERATION";
    }

    if (/linkedin|company page|engagement/.test(text)) {
      return "BUSINESS_OPERATION";
    }

    if (/status|what can you do|supported action/.test(text)) {
      return "EXECUTIVE_STATUS";
    }

    return "GENERAL_EXECUTIVE_COMMAND";
  }

  isRevenueOperationsMission(text) {
    const platformCount = [
      /instantly/.test(text),
      /google workspace|gmail|mailbox|inbox/.test(text),
      /namecheap|domain|dns|spf|dkim|dmarc/.test(text),
      /linkedin/.test(text),
      /segment|verified lead|lead file|campaign/.test(text)
    ].filter(Boolean).length;

    return (
      /own.*(outbound|revenue|instantly|campaign)/.test(text) ||
      /expand outbound|increase booked meetings/.test(text) ||
      /create.*mailbox|create.*email.*domain/.test(text) ||
      /assign.*campaign|upload.*lead|match.*lead.*segment/.test(text) ||
      /track.*response|run.*campaign/.test(text) ||
      platformCount >= 2
    );
  }

  resolveWorkflow(text, intent, operation = {}) {
    if (operation.workflow) return String(operation.workflow);
    if (intent === "REVENUE_OPERATIONS") return "REVENUE_OPERATIONS_MISSION";
    if (intent === "EXECUTIVE_STATUS") return "EXECUTIVE_STATUS";

    if (intent === "ENGINEERING") {
      if (/repository|search repository|repo search|code search/.test(text)) {
        return "ENGINEERING_REPOSITORY_SEARCH";
      }
      if (/code writer|writer capability|replacement source|replacement script|patch generator|code generation/.test(text)) {
        return "ENGINEERING_CODE_WRITER_AUDIT";
      }
      if (/runtime dispatch|dispatch diagnostic|dispatch trace|dispatcher|diagnostic harness|execution path|execution trace/.test(text)) {
        return "ENGINEERING_RUNTIME_DISPATCH_DIAGNOSTIC";
      }
      if (/self maintenance|self-maintenance|maintenance|health|degraded|repair myself|diagnose miles/.test(text)) {
        return "ENGINEERING_SELF_MAINTENANCE";
      }
      return "ENGINEERING_IMPROVEMENT";
    }

    if (intent === "EXECUTIVE_AUDIT") return "EXECUTIVE_INTEGRATION_AUDIT";
    if (intent === "CONNECTOR_OPERATION" && /orion/.test(text)) return "ORION_HEALTH_CHECK";

    if (intent === "BUSINESS_OPERATION") {
      if (/website/.test(text)) return "WEBSITE_REVIEW";
      if (/instantly|campaign|deliverability|bounce/.test(text)) return "INSTANTLY_LIVE_REVIEW";
      if (/linkedin/.test(text)) return "LINKEDIN_REVIEW";
      if (/google|gmail|workspace|calendar|drive/.test(text)) return "GOOGLE_WORKSPACE_REVIEW";
      return "BUSINESS_REVIEW";
    }

    return "GENERAL_EXECUTIVE_WORKFLOW";
  }

  resolveCapability(text, intent, workflow, operation = {}) {
    if (operation.capability) return String(operation.capability);
    if (intent === "REVENUE_OPERATIONS") return "BUSINESS_EXECUTION";
    if (intent === "EXECUTIVE_STATUS") return "STATUS";

    if (intent === "ENGINEERING") {
      if (workflow === "ENGINEERING_REPOSITORY_SEARCH") return "REPOSITORY_REGISTRY";
      if (workflow === "ENGINEERING_CODE_WRITER_AUDIT") return "ENGINEERING_ANALYZE";
      if (workflow === "ENGINEERING_RUNTIME_DISPATCH_DIAGNOSTIC") return "TEST_RUNTIME";
      if (workflow === "ENGINEERING_SELF_MAINTENANCE") return "SELF_MAINTENANCE";
      return "ENGINEERING_IMPROVEMENT";
    }

    if (intent === "EXECUTIVE_AUDIT") return "ENGINEERING_REPORT";
    if (workflow === "ORION_HEALTH_CHECK") return "ORION_HEALTH";
    if (workflow === "WEBSITE_REVIEW") return "WEBSITE_REVIEW";
    if (workflow === "INSTANTLY_LIVE_REVIEW") return "INSTANTLY_LIVE";
    return "BUSINESS_EXECUTION";
  }

  resolveProvider(text, intent, workflow, capability, operation = {}) {
    if (operation.provider && operation.forceProvider === true) {
      return String(operation.provider);
    }

    if (
      ["REVENUE_OPERATIONS","EXECUTIVE_STATUS","ENGINEERING","EXECUTIVE_AUDIT"]
        .includes(intent)
    ) return "MILES";

    if (workflow === "ORION_HEALTH_CHECK") return "ORION";
    return "MILES";
  }

  resolveAction(text, intent, workflow, capability, provider, operation = {}) {
    if (operation.action && operation.forceAction === true) {
      const forced = String(operation.action).toUpperCase();
      return forced === "MILES_EXECUTE" ? "BUSINESS_EXECUTION" : forced;
    }

    if (intent === "REVENUE_OPERATIONS") return "BUSINESS_EXECUTION";
    if (intent === "EXECUTIVE_STATUS") return "STATUS";
    if (intent === "ENGINEERING") return capability || "ENGINEERING_IMPROVEMENT";
    if (intent === "EXECUTIVE_AUDIT") return "ENGINEERING_REPORT";

    if (provider === "ORION") {
      if (/table|schema/.test(text)) return "ORION_TABLES";
      if (/contractor/.test(text)) return "ORION_CONTRACTORS";
      if (/buyer/.test(text)) return "ORION_BUYERS";
      if (/opportunit/.test(text)) return "ORION_OPPORTUNITIES";
      if (/recompete|expiration|expiring/.test(text)) return "ORION_RECOMPETES";
      if (/recommend/.test(text)) return "ORION_RECOMMENDATIONS";
      if (/persona/.test(text)) return "ORION_PERSONAS";
      if (/summary|executive|report|brief/.test(text)) return "ORION_SUMMARY";
      return "ORION_HEALTH";
    }

    if (workflow === "INSTANTLY_LIVE_REVIEW") return "INSTANTLY_LIVE";
    if (workflow === "WEBSITE_REVIEW") return "WEBSITE_REVIEW";
    return "BUSINESS_EXECUTION";
  }

  resolveConnector(provider, action, capability, operation = {}) {
    if (operation.connector && operation.forceConnector === true) {
      return String(operation.connector);
    }
    return provider === "ORION" ? "ORION" : "MILES";
  }

  resolveDepartment(intent, provider) {
    if (intent === "REVENUE_OPERATIONS") return "Revenue Operations";
    if (intent === "ENGINEERING") return "Engineering";
    if (provider === "ORION") return "ORION";
    return "Executive";
  }

  resolveSteps(text, intent, workflow, capability, provider, connector, action) {
    if (intent === "REVENUE_OPERATIONS") {
      return [
        {
          step: 1,
          provider: "MILES",
          connector: "MILES",
          capability: "PROVIDER_AUTHORITY",
          action: "PROVIDER_AUTHORITY",
          objective: "Verify authority, credentials, and write permissions for Instantly, Google Workspace, Namecheap, LinkedIn, ORION, and supporting systems."
        },
        {
          step: 2,
          provider: "MILES",
          connector: "MILES",
          capability: "PROVIDER_SYNC",
          action: "PROVIDER_SYNC",
          objective: "Synchronize domains, mailboxes, campaigns, segments, replies, and platform state."
        },
        {
          step: 3,
          provider: "MILES",
          connector: "MILES",
          capability: "INSTANTLY_LIVE",
          action: "INSTANTLY_LIVE",
          objective: "Perform live Instantly inventory, campaign, inbox, warmup, capacity, lead, reply, and deliverability assessment."
        },
        {
          step: 4,
          provider: "MILES",
          connector: "MILES",
          capability: "BUSINESS_EXECUTION",
          action: "BUSINESS_EXECUTION",
          objective: "Create and execute the authorized revenue-operations work required by the CEO objective."
        },
        {
          step: 5,
          provider: "MILES",
          connector: "MILES",
          capability: "CONTROLLED_WRITE",
          action: "CONTROLLED_WRITE",
          objective: "Stage protected external changes for governance approval before any customer-facing or paid action."
        }
      ];
    }

    return [{
      step: 1,
      provider,
      connector,
      capability,
      action,
      objective: text
    }];
  }
}

module.exports = new CommandIntentPlannerService();

'@ | Set-Content -Path $TargetPath -Encoding UTF8

$TestPath = Join-Path $TestDir "Test_Build029_ExecutiveIntentBridge.js"

@'
"use strict";

const assert = require("assert");
const planner = require("../SERVICES/CommandIntentPlannerService");

const SUPPORTED_ACTIONS = new Set([
  "STATUS","BUSINESS_EXECUTION","INSTANTLY_LIVE","PROVIDER_AUTHORITY",
  "PROVIDER_SYNC","CONTROLLED_WRITE","WEBSITE_REVIEW",
  "ENGINEERING_IMPROVEMENT","ENGINEERING_REPORT","SELF_MAINTENANCE",
  "ORION_HEALTH","ORION_TABLES","ORION_CONTRACTORS","ORION_BUYERS",
  "ORION_OPPORTUNITIES","ORION_RECOMPETES","ORION_RECOMMENDATIONS",
  "ORION_PERSONAS","ORION_SUMMARY"
]);

function main() {
  const status = planner.plan({ command: "Miles, run STATUS." });
  assert.strictEqual(status.provider, "MILES");
  assert.strictEqual(status.action, "STATUS");

  const authority = planner.plan({ command: "Miles, run PROVIDER_AUTHORITY." });
  assert.strictEqual(authority.action, "PROVIDER_AUTHORITY");

  const instantly = planner.plan({
    command: "Miles, review Instantly campaign health, replies, warmup, and deliverability."
  });
  assert.strictEqual(instantly.provider, "MILES");
  assert.strictEqual(instantly.action, "INSTANTLY_LIVE");

  const mission = planner.plan({
    command: "Miles, own Instantly end to end with Google Workspace, Namecheap, LinkedIn, existing segments, verified leads, campaigns, replies, and follow-up."
  });
  assert.strictEqual(mission.intent, "REVENUE_OPERATIONS");
  assert.strictEqual(mission.provider, "MILES");
  assert.strictEqual(mission.action, "BUSINESS_EXECUTION");
  assert.strictEqual(mission.steps.length, 5);
  assert.deepStrictEqual(
    mission.steps.map(step => step.action),
    ["PROVIDER_AUTHORITY","PROVIDER_SYNC","INSTANTLY_LIVE","BUSINESS_EXECUTION","CONTROLLED_WRITE"]
  );

  const fallback = planner.plan({
    command: "Miles, review the business and do the authorized work."
  });
  assert.notStrictEqual(fallback.action, "MILES_EXECUTE");
  assert(SUPPORTED_ACTIONS.has(fallback.action));

  console.log(JSON.stringify({
    ok: true,
    build: "029",
    tests: {
      statusRouting: "PASSED",
      authorityRouting: "PASSED",
      instantlyLiveRouting: "PASSED",
      revenueMissionClassification: "PASSED",
      multiStepExecutivePlan: "PASSED",
      unsupportedFallbackRemoved: "PASSED",
      businessExecutionFallback: "PASSED"
    },
    plans: { status, authority, instantly, mission, fallback }
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error.stack || error.message);
  process.exit(1);
}

'@ | Set-Content -Path $TestPath -Encoding UTF8

Write-Host ""
Write-Host "=== BUILD 029 SYNTAX VALIDATION ==="

$Files = @(
    ".\SERVICES\CommandIntentPlannerService.js",
    ".\SERVICES\digital_coo\MilesCommandCenter.js",
    ".\SERVICES\digital_coo\DigitalCOOHost.js",
    ".\TESTS\Test_Build029_ExecutiveIntentBridge.js"
)

foreach ($File in $Files) {
    & node --check $File
    if ($LASTEXITCODE -ne 0) {
        throw "Syntax failed: $File"
    }
    Write-Host "[PASS] $File"
}

Write-Host ""
Write-Host "=== BUILD 029 AUTOMATED TESTS ==="

$Output = & node $TestPath 2>&1
$ExitCode = $LASTEXITCODE
$Report = Join-Path $ReportDir "build_029_test_$Stamp.txt"

$Output | Tee-Object -FilePath $Report

if ($ExitCode -ne 0) {
    throw "Build 029 tests failed. Restore from $BackupRoot"
}

Write-Host ""
Write-Host "============================================================"
Write-Host "BUILD 029 EXECUTIVE INTENT BRIDGE INSTALLED AND VERIFIED"
Write-Host "============================================================"
Write-Host "Backup: $BackupRoot"
Write-Host "Report: $Report"
Write-Host ""
Write-Host "Restart production:"
Write-Host "taskkill /F /IM node.exe"
Write-Host "node StartMilesProduction.js"
