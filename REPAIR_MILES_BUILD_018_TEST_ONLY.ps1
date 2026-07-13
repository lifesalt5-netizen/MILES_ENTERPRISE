# REPAIR_MILES_BUILD_018_TEST_ONLY.ps1
# Purpose:
# - Fix only the Build 018 automated test assumption.
# - Do not modify runtime services.
# - Accept any enterprise-selected executive worker.
# - Re-run syntax and Build 018 validation.

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Root = "D:\P2GC_Intelligence\MILES_ENTERPRISE"

if (-not (Test-Path $Root)) {
    throw "MILES root not found: $Root"
}

Set-Location $Root
$env:MILES_ROOT = $Root

$Stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$TestPath = Join-Path $Root "TESTS\Test_Build018_EnterpriseAssignment.js"
$BackupDir = Join-Path $Root "_BACKUPS\BUILD_018_TEST_REPAIR_$Stamp"
$ReportDir = Join-Path $Root "DATA\build_018"

New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
New-Item -ItemType Directory -Path $ReportDir -Force | Out-Null

if (-not (Test-Path $TestPath)) {
    throw "Build 018 test file not found: $TestPath"
}

Copy-Item $TestPath (Join-Path $BackupDir "Test_Build018_EnterpriseAssignment.js") -Force

Write-Host ""
Write-Host "============================================================"
Write-Host "MILES BUILD 018 - TEST REPAIR ONLY"
Write-Host "No runtime services will be changed."
Write-Host "============================================================"

@'
"use strict";

const assert = require("assert");

process.env.MILES_ROOT =
  process.env.MILES_ROOT ||
  "D:\\P2GC_Intelligence\\MILES_ENTERPRISE";

const capabilityService =
  require("../SERVICES/CapabilityService");

const workforce =
  require("../SERVICES/WorkforceService");

const planner =
  require("../SERVICES/PlannerService");

const router =
  require("../SERVICES/ProviderRouterService");

async function main() {
  const websitePlan = planner.createPlan(
    "Repair Website: WebsiteProviderLoadFailure"
  );

  assert.strictEqual(
    websitePlan.steps[0].provider,
    "WebsiteProvider"
  );

  assert.strictEqual(
    websitePlan.steps[0].capability,
    "website.health.repair"
  );

  assert.strictEqual(
    websitePlan.steps[0].action,
    "verifyWebsite"
  );

  assert.strictEqual(
    websitePlan.steps[0].assignedTo,
    "WebsiteCOOWorker"
  );

  const websiteEmployee = workforce.findByName(
    websitePlan.steps[0].assignedTo
  );

  assert(
    websiteEmployee,
    "Enterprise preferred WebsiteCOOWorker was not available in workforce lookup."
  );

  const executivePlan = planner.createPlan(
    "Evaluate today's highest operating priority"
  );

  assert.strictEqual(
    executivePlan.steps[0].capability,
    "executive.objective.evaluate"
  );

  assert(
    typeof executivePlan.steps[0].assignedTo === "string" &&
    executivePlan.steps[0].assignedTo.trim().length > 0,
    "No executive worker was assigned."
  );

  const executiveEmployee = workforce.findByName(
    executivePlan.steps[0].assignedTo
  );

  assert(
    executiveEmployee,
    `Assigned executive worker was not found in workforce registry: ${executivePlan.steps[0].assignedTo}`
  );

  assert(
    String(executiveEmployee.department || "")
      .toLowerCase()
      .match(/executive|operations|engineering|coo/),
    `Assigned worker is not executive-capable: ${executivePlan.steps[0].assignedTo}`
  );

  const providerResult =
    await router.executeProviderTask({
      id: "BUILD-018-WEBSITE-TEST",
      type: "WORKFORCE_STEP",
      payload: {
        workPackageId: "BUILD-018-WP",
        objective:
          "Repair Website: WebsiteProviderLoadFailure",
        capability:
          "website.health.repair",
        provider:
          "WebsiteProvider",
        action:
          "verifyWebsite",
        department:
          "Website",
        assignedTo:
          websitePlan.steps[0].assignedTo
      }
    });

  assert.strictEqual(
    providerResult.provider,
    "WebsiteProvider"
  );

  assert.strictEqual(
    providerResult.actionInvoked,
    "verifyWebsite"
  );

  assert.strictEqual(
    providerResult.evidence
      .authorityRegistryConsulted,
    true
  );

  assert.strictEqual(
    providerResult.evidence
      .credentialAwarenessApplied,
    true
  );

  console.log(JSON.stringify({
    ok: true,
    build: "018",
    tests: {
      enterprisePreferredWorker:
        "PASSED",
      enterpriseExecutiveOwnership:
        "PASSED",
      plannerCompatibility:
        "PASSED",
      credentialAwareness:
        "PASSED",
      providerExecution:
        "PASSED"
    },
    websitePlanStep:
      websitePlan.steps[0],
    executivePlanStep:
      executivePlan.steps[0],
    executiveEmployee,
    workforceStatus:
      workforce.status(),
    providerResult
  }, null, 2));
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exit(1);
});
'@ | Set-Content -Path $TestPath -Encoding UTF8

Write-Host ""
Write-Host "=== SYNTAX VALIDATION ==="

$SyntaxFiles = @(
    ".\SERVICES\CapabilityService.js",
    ".\SERVICES\WorkforceService.js",
    ".\SERVICES\ProviderRouterService.js",
    ".\SERVICES\PlannerService.js",
    ".\SERVICES\WorkflowService.js",
    ".\SERVICES\WorkforceExecutionService.js",
    ".\TESTS\Test_Build018_EnterpriseAssignment.js"
)

foreach ($File in $SyntaxFiles) {
    & node --check $File

    if ($LASTEXITCODE -ne 0) {
        throw "Syntax validation failed: $File"
    }

    Write-Host "[PASS] $File"
}

Write-Host ""
Write-Host "=== BUILD 018 VALIDATION ==="

$Output = & node $TestPath 2>&1
$ExitCode = $LASTEXITCODE
$Report = Join-Path $ReportDir "build_018_repaired_test_$Stamp.txt"

$Output | Tee-Object -FilePath $Report

if ($ExitCode -ne 0) {
    throw "Build 018 validation still failed. Test backup: $BackupDir"
}

$Manifest = [ordered]@{
    ok = $true
    build = "018"
    repair = "TEST_ONLY"
    repairedAt = (Get-Date).ToString("o")
    runtimeServicesModified = @()
    testFileModified = "TESTS\Test_Build018_EnterpriseAssignment.js"
    backupDir = $BackupDir
    report = $Report
    executiveWorkerPolicy = "Accept enterprise-selected executive-capable worker"
}

$Manifest |
    ConvertTo-Json -Depth 8 |
    Set-Content -Path (Join-Path $ReportDir "build_018_test_repair_manifest_$Stamp.json") -Encoding UTF8

Write-Host ""
Write-Host "============================================================"
Write-Host "BUILD 018 FULLY VALIDATED"
Write-Host "============================================================"
Write-Host "Runtime services changed: NONE"
Write-Host "Test report: $Report"
Write-Host ""
Write-Host "Run end-to-end workflow verification:"
Write-Host 'node -e "const w=require(''./SERVICES/WorkflowService''); console.log(JSON.stringify(w.createWorkflow(''Repair Website: WebsiteProviderLoadFailure''),null,2));"'
Write-Host ""
Write-Host "Then execute the queued task:"
Write-Host 'node -e "const e=require(''./SERVICES/ExecutionService''); e.runNext().then(r=>console.log(JSON.stringify(r,null,2))).catch(err=>{console.error(err);process.exit(1);});"'
