# INSTALL_MILES_BUILD_017_WORKFORCE_CAPABILITY_NORMALIZATION.ps1
# Build 017 scope:
# - Replace only SERVICES\WorkforceService.js
# - Preserve Build 016 planning, routing, execution, governance, and verification
# - Add canonical capability normalization and real workforce assignment
# - Backup, syntax validation, automated tests, and live planner verification

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Root = "D:\P2GC_Intelligence\MILES_ENTERPRISE"

if (-not (Test-Path $Root)) {
    throw "Authoritative MILES root not found: $Root"
}

Set-Location $Root
$env:MILES_ROOT = $Root

$Stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$BackupRoot = Join-Path $Root "_BACKUPS\BUILD_017_$Stamp"
$TestDir = Join-Path $Root "TESTS"
$ReportDir = Join-Path $Root "DATA\build_017"

New-Item -ItemType Directory -Path $BackupRoot -Force | Out-Null
New-Item -ItemType Directory -Path $TestDir -Force | Out-Null
New-Item -ItemType Directory -Path $ReportDir -Force | Out-Null

$Target = "SERVICES\WorkforceService.js"
$Source = Join-Path $Root $Target

if (-not (Test-Path $Source)) {
    throw "Required authoritative file not found: $Source"
}

$BackupPath = Join-Path $BackupRoot $Target
New-Item -ItemType Directory -Path (Split-Path $BackupPath -Parent) -Force | Out-Null
Copy-Item $Source $BackupPath -Force

Write-Host ""
Write-Host "============================================================"
Write-Host "MILES BUILD 017 - WORKFORCE CAPABILITY NORMALIZATION"
Write-Host "Root:   $Root"
Write-Host "Backup: $BackupRoot"
Write-Host "============================================================"
Write-Host "[BACKUP] $Target"

@'
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT || process.cwd();
const REGISTRY_PATH = path.join(
  ROOT,
  "CONFIG",
  "WORKFORCE",
  "MILES_WORKFORCE_REGISTRY.json"
);

const CANONICAL_CAPABILITY_ALIASES = Object.freeze({
  "website.health.repair": [
    "website",
    "website operations",
    "website management",
    "website maintenance",
    "website health",
    "website audit",
    "website repair",
    "b12",
    "web operations",
    "digital infrastructure",
    "site availability",
    "ssl",
    "dns"
  ],
  "website.health.verify": [
    "website",
    "website operations",
    "website management",
    "website maintenance",
    "website health",
    "website audit",
    "website verification",
    "b12",
    "web operations",
    "digital infrastructure",
    "site availability",
    "ssl",
    "dns"
  ],
  "marketing.campaign.audit": [
    "marketing",
    "marketing operations",
    "email marketing",
    "email outreach",
    "outbound",
    "outreach",
    "instantly",
    "campaign",
    "campaign management",
    "campaign audit",
    "deliverability",
    "bounce",
    "inbox",
    "lead upload",
    "millionverifier",
    "linkedin"
  ],
  "orion.refresh": [
    "orion",
    "orion operations",
    "orion data",
    "data operations",
    "government data",
    "contractor intelligence",
    "buyer intelligence",
    "opportunity intelligence",
    "recompete",
    "forecast",
    "sources sought",
    "rfi",
    "sam",
    "gsa",
    "va fss",
    "usaspending"
  ],
  "executive.objective.evaluate": [
    "executive",
    "operations",
    "digital coo",
    "chief operating officer",
    "objective evaluation",
    "priority",
    "governance"
  ]
});

function normalizeList(value) {
  if (!value) return [];

  if (Array.isArray(value)) {
    return value
      .flatMap(item => normalizeList(item))
      .map(item => String(item).trim())
      .filter(Boolean);
  }

  if (typeof value === "object") {
    return Object.entries(value)
      .flatMap(([key, item]) => {
        if (item === true) return [key];
        if (typeof item === "string") return [key, item];
        if (Array.isArray(item)) return [key, ...item];
        return [key];
      })
      .map(item => String(item).trim())
      .filter(Boolean);
  }

  return String(value)
    .split(/[,;\n|]/)
    .map(item => item.trim())
    .filter(Boolean);
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function employeeName(employee = {}) {
  return (
    employee.name ||
    employee.employee ||
    employee.id ||
    employee.worker ||
    employee.title ||
    "UNKNOWN"
  );
}

function employeeSearchText(employee = {}) {
  return normalizeText([
    employeeName(employee),
    employee.department,
    employee.mission,
    employee.role,
    employee.title,
    employee.description,
    employee.authority,
    ...normalizeList(employee.capabilities),
    ...normalizeList(employee.owns),
    ...normalizeList(employee.skills),
    ...normalizeList(employee.responsibilities),
    ...normalizeList(employee.functions),
    ...normalizeList(employee.domains),
    ...normalizeList(employee.systems),
    ...normalizeList(employee.providers)
  ].filter(Boolean).join(" "));
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function directCapabilities(employee = {}) {
  return unique([
    ...normalizeList(employee.capabilities),
    ...normalizeList(employee.owns),
    ...normalizeList(employee.skills)
  ]).map(normalizeText);
}

function canonicalCapabilitiesForEmployee(employee = {}) {
  const direct = directCapabilities(employee);
  const searchable = employeeSearchText(employee);
  const canonical = [];

  for (const [capability, aliases] of Object.entries(
    CANONICAL_CAPABILITY_ALIASES
  )) {
    if (direct.includes(capability)) {
      canonical.push(capability);
      continue;
    }

    const matched = aliases.some(alias => {
      const normalizedAlias = normalizeText(alias);
      return searchable.includes(normalizedAlias);
    });

    if (matched) canonical.push(capability);
  }

  return unique(canonical);
}

function scoreEmployeeForCapability(employee = {}, capability = "") {
  const canonical = canonicalCapabilitiesForEmployee(employee);
  const search = employeeSearchText(employee);
  const aliases = CANONICAL_CAPABILITY_ALIASES[capability] || [];
  let score = 0;
  const reasons = [];

  if (canonical.includes(capability)) {
    score += 100;
    reasons.push("canonical capability match");
  }

  const direct = directCapabilities(employee);

  if (direct.includes(capability)) {
    score += 100;
    reasons.push("direct capability identifier");
  }

  const capabilityParts = normalizeText(capability)
    .split(/[.\s]+/)
    .filter(part => part.length > 2);

  for (const part of capabilityParts) {
    if (search.includes(part)) {
      score += 10;
      reasons.push(`capability token: ${part}`);
    }
  }

  for (const alias of aliases) {
    const normalizedAlias = normalizeText(alias);

    if (search.includes(normalizedAlias)) {
      score += normalizedAlias.includes(" ") ? 20 : 10;
      reasons.push(`alias: ${alias}`);
    }
  }

  const department = normalizeText(employee.department);

  if (
    capability.startsWith("website.") &&
    /website|digital|web|infrastructure/.test(department)
  ) {
    score += 30;
    reasons.push("website-aligned department");
  }

  if (
    capability.startsWith("marketing.") &&
    /marketing|sales|outreach|email/.test(department)
  ) {
    score += 30;
    reasons.push("marketing-aligned department");
  }

  if (
    capability.startsWith("orion.") &&
    /orion|data|intelligence|opportunity|research/.test(department)
  ) {
    score += 30;
    reasons.push("ORION-aligned department");
  }

  if (
    capability.startsWith("executive.") &&
    /executive|operations|leadership|coo/.test(department)
  ) {
    score += 30;
    reasons.push("executive-aligned department");
  }

  return {
    score,
    reasons: unique(reasons)
  };
}

class WorkforceService {
  load() {
    if (!fs.existsSync(REGISTRY_PATH)) {
      return {
        employees: [],
        error: `Missing workforce registry: ${REGISTRY_PATH}`
      };
    }

    try {
      const raw = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8"));
      const employees = Array.isArray(raw)
        ? raw
        : (
            raw.employees ||
            raw.workforce ||
            raw.workers ||
            raw.members ||
            []
          );

      return {
        employees: Array.isArray(employees) ? employees : []
      };
    } catch (err) {
      return {
        employees: [],
        error: `Invalid workforce registry: ${err.message}`
      };
    }
  }

  all() {
    return this.load().employees;
  }

  enriched() {
    return this.all().map(employee => ({
      ...employee,
      canonicalCapabilities:
        canonicalCapabilitiesForEmployee(employee)
    }));
  }

  capabilityGraph() {
    const graph = {};

    for (const employee of this.enriched()) {
      const name = employeeName(employee);
      const declaredCapabilities = directCapabilities(employee);
      const canonicalCapabilities =
        employee.canonicalCapabilities || [];

      const capabilities = unique([
        ...declaredCapabilities,
        ...canonicalCapabilities
      ]);

      for (const capability of capabilities) {
        const key = normalizeText(capability);
        if (!key) continue;

        if (!graph[key]) graph[key] = [];

        graph[key].push({
          employee: name,
          department: employee.department || "",
          mission: employee.mission || "",
          authority: employee.authority || "Operational",
          role: employee.role || employee.title || "",
          canonicalCapabilities,
          source:
            canonicalCapabilities.includes(key)
              ? "CANONICAL_NORMALIZATION"
              : "REGISTRY_DECLARATION"
        });
      }
    }

    return graph;
  }

  findByCapability(query) {
    const capability = normalizeText(query);
    const graph = this.capabilityGraph();
    const exact = graph[capability] || [];

    if (exact.length > 0) {
      return [{
        capability,
        employees: exact
      }];
    }

    const matches = [];

    for (const employee of this.enriched()) {
      const scored = scoreEmployeeForCapability(
        employee,
        capability
      );

      if (scored.score <= 0) continue;

      matches.push({
        employee: employeeName(employee),
        department: employee.department || "",
        mission: employee.mission || "",
        authority: employee.authority || "Operational",
        role: employee.role || employee.title || "",
        canonicalCapabilities:
          employee.canonicalCapabilities || [],
        score: scored.score,
        matchReasons: scored.reasons,
        source: "CANONICAL_SCORING"
      });
    }

    matches.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.employee.localeCompare(b.employee);
    });

    return matches.length > 0
      ? [{
          capability,
          employees: matches
        }]
      : [];
  }

  resolveBestWorker(capability, options = {}) {
    const candidates = this.findByCapability(capability);
    const employees = candidates?.[0]?.employees || [];

    if (employees.length === 0) {
      return {
        ok: false,
        capability,
        worker: null,
        candidates: [],
        fallback: options.fallback || "MILES"
      };
    }

    return {
      ok: true,
      capability,
      worker: employees[0],
      candidates: employees,
      fallback: null
    };
  }

  plan(objective) {
    const text = normalizeText(objective);

    const capabilityHints = {
      "website.health.repair":
        /website|b12|site|ssl|dns|web operations/,
      "website.health.verify":
        /website|b12|site|ssl|dns|web operations/,
      "marketing.campaign.audit":
        /instantly|campaign|deliverability|bounce|inbox|email outreach|marketing/,
      "orion.refresh":
        /orion|government data|contractor intelligence|buyer intelligence|opportunity intelligence|recompete|forecast|sources sought|rfi/
    };

    const required = Object.entries(capabilityHints)
      .filter(([, pattern]) => pattern.test(text))
      .map(([capability]) => capability);

    return {
      ok: true,
      objective,
      requiredCapabilities: required,
      assignments: required.map(capability => ({
        capability,
        candidates: this.findByCapability(capability),
        bestWorker:
          this.resolveBestWorker(capability).worker
      }))
    };
  }

  status() {
    const loadResult = this.load();
    const employees = loadResult.employees || [];
    const graph = this.capabilityGraph();
    const canonicalCounts = {};

    for (const capability of Object.keys(
      CANONICAL_CAPABILITY_ALIASES
    )) {
      canonicalCounts[capability] =
        (graph[capability] || []).length;
    }

    return {
      ok: !loadResult.error,
      employees: employees.length,
      capabilities: Object.keys(graph).length,
      canonicalCapabilities: canonicalCounts,
      registryPath: REGISTRY_PATH,
      error: loadResult.error || null
    };
  }
}

module.exports = new WorkforceService();
'@ | Set-Content -Path $Source -Encoding UTF8

@'
"use strict";

const assert = require("assert");

process.env.MILES_ROOT =
  process.env.MILES_ROOT ||
  "D:\\P2GC_Intelligence\\MILES_ENTERPRISE";

const workforce = require("../SERVICES/WorkforceService");
const capabilityService = require("../SERVICES/CapabilityService");
const planner = require("../SERVICES/PlannerService");

function summarizeWorker(worker) {
  if (!worker) return null;

  return {
    employee: worker.employee,
    department: worker.department,
    role: worker.role,
    score: worker.score,
    source: worker.source,
    canonicalCapabilities: worker.canonicalCapabilities,
    matchReasons: worker.matchReasons
  };
}

function main() {
  const status = workforce.status();

  assert.strictEqual(
    status.ok,
    true,
    status.error || "Workforce registry failed to load."
  );

  assert(
    status.employees > 0,
    "Workforce registry contains no employees."
  );

  const website = workforce.resolveBestWorker(
    "website.health.repair"
  );
  const marketing = workforce.resolveBestWorker(
    "marketing.campaign.audit"
  );
  const orion = workforce.resolveBestWorker(
    "orion.refresh"
  );

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

  if (website.ok) {
    assert.notStrictEqual(
      websitePlan.steps[0].assignedTo,
      "MILES",
      "A website worker was found but PlannerService still assigned MILES."
    );
  }

  const capabilityPlan = capabilityService.planObjective(
    "Repair Website: WebsiteProviderLoadFailure"
  );

  console.log(JSON.stringify({
    ok: true,
    build: "017",
    workforceStatus: status,
    resolutions: {
      website: {
        found: website.ok,
        worker: summarizeWorker(website.worker),
        candidateCount: website.candidates.length
      },
      marketing: {
        found: marketing.ok,
        worker: summarizeWorker(marketing.worker),
        candidateCount: marketing.candidates.length
      },
      orion: {
        found: orion.ok,
        worker: summarizeWorker(orion.worker),
        candidateCount: orion.candidates.length
      }
    },
    websitePlanStep: websitePlan.steps[0],
    capabilityAssignment:
      capabilityPlan.assignments?.[0] || null
  }, null, 2));
}

try {
  main();
} catch (err) {
  console.error(err.stack || err.message);
  process.exit(1);
}
'@ | Set-Content -Path (Join-Path $TestDir "Test_Build017_WorkforceNormalization.js") -Encoding UTF8

Write-Host ""
Write-Host "=== SYNTAX VALIDATION ==="

$SyntaxFiles = @(
    ".\SERVICES\WorkforceService.js",
    ".\SERVICES\CapabilityService.js",
    ".\SERVICES\PlannerService.js",
    ".\TESTS\Test_Build017_WorkforceNormalization.js"
)

foreach ($File in $SyntaxFiles) {
    & node --check $File

    if ($LASTEXITCODE -ne 0) {
        throw "Syntax validation failed: $File"
    }

    Write-Host "[PASS] $File"
}

Write-Host ""
Write-Host "=== AUTOMATED BUILD 017 TESTS ==="

$TestOutput = & node ".\TESTS\Test_Build017_WorkforceNormalization.js" 2>&1
$TestExit = $LASTEXITCODE

$TestReport = Join-Path $ReportDir "build_017_test_output_$Stamp.txt"
$TestOutput | Tee-Object -FilePath $TestReport

if ($TestExit -ne 0) {
    throw "Build 017 automated tests failed. Backups are available at $BackupRoot"
}

Write-Host ""
Write-Host "=== LIVE PLANNER VERIFICATION ==="

$VerifyFile = Join-Path $TestDir "Verify_Build017_Planner.js"

@'
"use strict";

const planner = require("../SERVICES/PlannerService");
const workforce = require("../SERVICES/WorkforceService");

const plan = planner.createPlan(
  "Repair Website: WebsiteProviderLoadFailure"
);

console.log(JSON.stringify({
  ok: true,
  workforceStatus: workforce.status(),
  objective: plan.objective,
  resolution: plan.resolution,
  step: plan.steps[0]
}, null, 2));
'@ | Set-Content -Path $VerifyFile -Encoding UTF8

& node --check $VerifyFile

if ($LASTEXITCODE -ne 0) {
    throw "Live verification script failed syntax validation."
}

$VerificationOutput = & node $VerifyFile 2>&1
$VerificationExit = $LASTEXITCODE
$VerificationReport = Join-Path $ReportDir "build_017_planner_verification_$Stamp.txt"

$VerificationOutput | Tee-Object -FilePath $VerificationReport

if ($VerificationExit -ne 0) {
    throw "Build 017 planner verification failed."
}

$Manifest = [ordered]@{
    ok = $true
    build = "017"
    installedAt = (Get-Date).ToString("o")
    root = $Root
    backupRoot = $BackupRoot
    replacedFiles = @(
        "SERVICES\WorkforceService.js"
    )
    preservedFiles = @(
        "SERVICES\CapabilityService.js",
        "SERVICES\PlannerService.js",
        "SERVICES\ProviderRouterService.js",
        "SERVICES\WorkflowService.js",
        "SERVICES\WorkPackageService.js",
        "SERVICES\ExecutionService.js",
        "SERVICES\WorkforceExecutionService.js",
        "PROVIDERS\providers\WebsiteProvider.js",
        "PROVIDERS\providers\MarketingProvider.js",
        "PROVIDERS\providers\OrionProvider.js"
    )
    testFile = "TESTS\Test_Build017_WorkforceNormalization.js"
    verificationFile = "TESTS\Verify_Build017_Planner.js"
    reports = @(
        $TestReport,
        $VerificationReport
    )
}

$ManifestPath = Join-Path $ReportDir "build_017_manifest_$Stamp.json"

$Manifest |
    ConvertTo-Json -Depth 8 |
    Set-Content -Path $ManifestPath -Encoding UTF8

Write-Host ""
Write-Host "============================================================"
Write-Host "BUILD 017 INSTALLED AND VERIFIED"
Write-Host "============================================================"
Write-Host "Backups: $BackupRoot"
Write-Host "Reports: $ReportDir"
Write-Host ""
Write-Host "Next end-to-end verification:"
Write-Host 'node -e "const w=require(''./SERVICES/WorkflowService''); console.log(JSON.stringify(w.createWorkflow(''Repair Website: WebsiteProviderLoadFailure''),null,2));"'
Write-Host ""
Write-Host 'node -e "const e=require(''./SERVICES/ExecutionService''); e.runNext().then(r=>console.log(JSON.stringify(r,null,2))).catch(err=>{console.error(err);process.exit(1);});"'
