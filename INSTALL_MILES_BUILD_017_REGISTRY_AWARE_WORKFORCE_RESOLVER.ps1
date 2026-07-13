# INSTALL_MILES_BUILD_017_REGISTRY_AWARE_WORKFORCE_RESOLVER.ps1
# Authoritative Build 017 replacement
# Scope: SERVICES\WorkforceService.js only
# Integrates existing workforce/runtime/capability-owner registries.
# Does not create a new registry, planner, router, or execution path.

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
$TargetPath = Join-Path $Root $Target

if (-not (Test-Path $TargetPath)) {
    throw "Required authoritative service not found: $TargetPath"
}

$BackupPath = Join-Path $BackupRoot $Target
New-Item -ItemType Directory -Path (Split-Path $BackupPath -Parent) -Force | Out-Null
Copy-Item $TargetPath $BackupPath -Force

Write-Host ""
Write-Host "============================================================"
Write-Host "MILES BUILD 017 - REGISTRY-AWARE WORKFORCE RESOLVER"
Write-Host "Root:   $Root"
Write-Host "Backup: $BackupRoot"
Write-Host "============================================================"
Write-Host "[BACKUP] $Target"

@'
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT || process.cwd();

const SOURCES = Object.freeze({
  workforce: path.join(
    ROOT,
    "CONFIG",
    "WORKFORCE",
    "MILES_WORKFORCE_REGISTRY.json"
  ),
  runtimeWorkers: path.join(
    ROOT,
    "DATA",
    "runtime",
    "worker_registry.json"
  ),
  repositoryWorkers: path.join(
    ROOT,
    "DATA",
    "repository",
    "worker_registry.json"
  ),
  capabilityOwners: path.join(
    ROOT,
    "DATA",
    "capability",
    "capability_owner_map.json"
  ),
  capabilityExecution: path.join(
    ROOT,
    "DATA",
    "capability",
    "capability_execution_map.json"
  )
});

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    return {
      ok: false,
      filePath,
      value: null,
      error: "FILE_NOT_FOUND"
    };
  }

  try {
    return {
      ok: true,
      filePath,
      value: JSON.parse(fs.readFileSync(filePath, "utf8")),
      error: null
    };
  } catch (err) {
    return {
      ok: false,
      filePath,
      value: null,
      error: err.message
    };
  }
}

function asArray(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value;

  if (typeof value === "object") {
    return Object.entries(value).map(([key, item]) => {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        return {
          id: item.id || key,
          name: item.name || item.employee || item.worker || key,
          ...item
        };
      }

      return {
        id: key,
        name: key,
        value: item
      };
    });
  }

  return [value];
}

function list(value) {
  if (value == null) return [];

  if (Array.isArray(value)) {
    return value
      .flatMap(item => list(item))
      .map(item => String(item).trim())
      .filter(Boolean);
  }

  if (typeof value === "object") {
    return Object.entries(value)
      .flatMap(([key, item]) => {
        if (item === true) return [key];
        if (item === false || item == null) return [];
        if (Array.isArray(item)) return [key, ...item];
        if (typeof item === "string") return [key, item];
        if (typeof item === "object") {
          return [
            key,
            item.name,
            item.capability,
            item.skill,
            item.domain,
            item.provider
          ].filter(Boolean);
        }
        return [key, item];
      })
      .map(item => String(item).trim())
      .filter(Boolean);
  }

  return String(value)
    .split(/[,;\n|]/)
    .map(item => item.trim())
    .filter(Boolean);
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function keyOf(value) {
  return normalize(value).replace(/\s+/g, "");
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function employeeName(employee = {}) {
  return (
    employee.name ||
    employee.employee ||
    employee.worker ||
    employee.workerName ||
    employee.employeeName ||
    employee.id ||
    employee.key ||
    employee.title ||
    "UNKNOWN"
  );
}

function employeeDepartment(employee = {}) {
  return (
    employee.department ||
    employee.team ||
    employee.workforce ||
    employee.division ||
    employee.unit ||
    ""
  );
}

function employeeMission(employee = {}) {
  return (
    employee.mission ||
    employee.description ||
    employee.purpose ||
    employee.summary ||
    ""
  );
}

function employeeAuthority(employee = {}) {
  return (
    employee.authority ||
    employee.executionAuthority ||
    employee.access ||
    "Operational"
  );
}

function employeeCapabilities(employee = {}) {
  return unique([
    ...list(employee.capabilities),
    ...list(employee.capability),
    ...list(employee.owns),
    ...list(employee.skills),
    ...list(employee.skill),
    ...list(employee.responsibilities),
    ...list(employee.functions),
    ...list(employee.domains),
    ...list(employee.domain),
    ...list(employee.systems),
    ...list(employee.providers),
    ...list(employee.provider),
    ...list(employee.actions)
  ]);
}

function flattenEmployees(raw, sourceName) {
  if (raw == null) return [];

  const candidateCollections = [
    raw,
    raw.employees,
    raw.workforce,
    raw.workers,
    raw.members,
    raw.registry,
    raw.items,
    raw.records,
    raw.data
  ].filter(Boolean);

  let records = [];

  for (const collection of candidateCollections) {
    const current = asArray(collection);

    if (current.length > records.length) {
      records = current;
    }
  }

  return records
    .filter(record => record && typeof record === "object")
    .map(record => ({
      ...record,
      _registrySource: sourceName
    }));
}

function capabilityTokens(capability) {
  const normalized = normalize(capability);

  return unique([
    normalized,
    ...normalized.split(/[.\s]+/).filter(token => token.length > 2)
  ]);
}

function canonicalAliases(capability) {
  const map = {
    "website.health.repair": [
      "website",
      "website operations",
      "website maintenance",
      "website repair",
      "website health",
      "b12",
      "web",
      "digital infrastructure",
      "dns",
      "ssl"
    ],
    "website.health.verify": [
      "website",
      "website operations",
      "website audit",
      "website verification",
      "website health",
      "b12",
      "web",
      "digital infrastructure",
      "dns",
      "ssl"
    ],
    "marketing.campaign.audit": [
      "marketing",
      "marketing operations",
      "instantly",
      "campaign",
      "email outreach",
      "outbound",
      "deliverability",
      "bounce",
      "inbox",
      "millionverifier",
      "linkedin"
    ],
    "orion.refresh": [
      "orion",
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
      "governance",
      "priority"
    ]
  };

  return map[normalize(capability)] || [];
}

function searchableEmployeeText(employee = {}) {
  return normalize([
    employeeName(employee),
    employeeDepartment(employee),
    employeeMission(employee),
    employee.role,
    employee.title,
    employeeAuthority(employee),
    ...employeeCapabilities(employee)
  ].filter(Boolean).join(" "));
}

function parseCapabilityOwnerRecords(raw) {
  if (raw == null) return [];

  const records = [];

  function visit(node, inheritedCapability = null) {
    if (node == null) return;

    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item, inheritedCapability);
      }
      return;
    }

    if (typeof node !== "object") return;

    const capability =
      node.capability ||
      node.capabilityId ||
      node.capability_id ||
      node.name ||
      inheritedCapability;

    const ownerValues = unique([
      ...list(node.owner),
      ...list(node.owners),
      ...list(node.employee),
      ...list(node.employees),
      ...list(node.worker),
      ...list(node.workers),
      ...list(node.assignedTo),
      ...list(node.assigned_to),
      ...list(node.department)
    ]);

    if (capability && ownerValues.length > 0) {
      for (const owner of ownerValues) {
        records.push({
          capability: String(capability),
          owner: String(owner)
        });
      }
    }

    for (const [key, value] of Object.entries(node)) {
      if ([
        "owner",
        "owners",
        "employee",
        "employees",
        "worker",
        "workers",
        "assignedTo",
        "assigned_to",
        "department"
      ].includes(key)) {
        continue;
      }

      visit(value, capability || key);
    }
  }

  visit(raw);
  return records;
}

function parseExecutionRecords(raw) {
  if (raw == null) return [];

  const records = [];

  function visit(node, inheritedCapability = null) {
    if (node == null) return;

    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item, inheritedCapability);
      }
      return;
    }

    if (typeof node !== "object") return;

    const capability =
      node.capability ||
      node.capabilityId ||
      node.capability_id ||
      inheritedCapability;

    const worker =
      node.worker ||
      node.employee ||
      node.owner ||
      node.assignedTo ||
      node.assigned_to ||
      null;

    if (capability && worker) {
      records.push({
        capability: String(capability),
        owner: String(worker)
      });
    }

    for (const [key, value] of Object.entries(node)) {
      visit(value, capability || key);
    }
  }

  visit(raw);
  return records;
}

function mergeEmployees(baseEmployees, ownerRecords) {
  const byName = new Map();

  function upsert(employee) {
    const name = employeeName(employee);
    const key = keyOf(name);

    if (!key || name === "UNKNOWN") return;

    const existing = byName.get(key) || {
      name,
      department: "",
      mission: "",
      authority: "Operational",
      capabilities: [],
      registrySources: []
    };

    existing.name = existing.name || name;
    existing.department =
      existing.department ||
      employeeDepartment(employee);
    existing.mission =
      existing.mission ||
      employeeMission(employee);
    existing.authority =
      existing.authority ||
      employeeAuthority(employee);
    existing.role =
      existing.role ||
      employee.role ||
      employee.title ||
      "";

    existing.capabilities = unique([
      ...existing.capabilities,
      ...employeeCapabilities(employee)
    ]);

    existing.registrySources = unique([
      ...existing.registrySources,
      employee._registrySource
    ]);

    byName.set(key, existing);
  }

  for (const employee of baseEmployees) {
    upsert(employee);
  }

  for (const record of ownerRecords) {
    const key = keyOf(record.owner);
    const existing = byName.get(key);

    if (existing) {
      existing.capabilities = unique([
        ...existing.capabilities,
        record.capability
      ]);
      existing.registrySources = unique([
        ...existing.registrySources,
        "capability_owner_map"
      ]);
      continue;
    }

    upsert({
      name: record.owner,
      capabilities: [record.capability],
      _registrySource: "capability_owner_map"
    });
  }

  return [...byName.values()];
}

function scoreEmployee(employee, capability) {
  const target = normalize(capability);
  const capabilities = employeeCapabilities(employee)
    .map(normalize);
  const search = searchableEmployeeText(employee);
  const aliases = canonicalAliases(target);
  const tokens = capabilityTokens(target);

  let score = 0;
  const reasons = [];

  if (capabilities.includes(target)) {
    score += 250;
    reasons.push("exact canonical capability");
  }

  for (const declared of capabilities) {
    if (!declared) continue;

    if (
      declared.includes(target) ||
      target.includes(declared)
    ) {
      score += 120;
      reasons.push(`declared capability: ${declared}`);
    }
  }

  for (const alias of aliases) {
    const normalizedAlias = normalize(alias);

    if (search.includes(normalizedAlias)) {
      score += normalizedAlias.includes(" ") ? 35 : 20;
      reasons.push(`alias: ${alias}`);
    }
  }

  for (const token of tokens) {
    if (search.includes(token)) {
      score += 10;
      reasons.push(`token: ${token}`);
    }
  }

  const department = normalize(employeeDepartment(employee));

  if (
    target.startsWith("website.") &&
    /website|web|digital|infrastructure/.test(department)
  ) {
    score += 50;
    reasons.push("website-aligned department");
  }

  if (
    target.startsWith("marketing.") &&
    /marketing|sales|email|outreach/.test(department)
  ) {
    score += 50;
    reasons.push("marketing-aligned department");
  }

  if (
    target.startsWith("orion.") &&
    /orion|data|intelligence|research|opportunity/.test(department)
  ) {
    score += 50;
    reasons.push("ORION-aligned department");
  }

  if (
    target.startsWith("executive.") &&
    /executive|operations|leadership|coo/.test(department)
  ) {
    score += 50;
    reasons.push("executive-aligned department");
  }

  return {
    score,
    reasons: unique(reasons)
  };
}

class WorkforceService {
  loadSources() {
    return {
      workforce: readJson(SOURCES.workforce),
      runtimeWorkers: readJson(SOURCES.runtimeWorkers),
      repositoryWorkers: readJson(SOURCES.repositoryWorkers),
      capabilityOwners: readJson(SOURCES.capabilityOwners),
      capabilityExecution: readJson(SOURCES.capabilityExecution)
    };
  }

  load() {
    const sources = this.loadSources();

    const employees = [
      ...flattenEmployees(
        sources.workforce.value,
        "MILES_WORKFORCE_REGISTRY"
      ),
      ...flattenEmployees(
        sources.runtimeWorkers.value,
        "runtime_worker_registry"
      ),
      ...flattenEmployees(
        sources.repositoryWorkers.value,
        "repository_worker_registry"
      )
    ];

    const ownerRecords = unique(
      [
        ...parseCapabilityOwnerRecords(
          sources.capabilityOwners.value
        ),
        ...parseExecutionRecords(
          sources.capabilityExecution.value
        )
      ].map(record =>
        `${record.capability}|||${record.owner}`
      )
    ).map(value => {
      const [capability, owner] = value.split("|||");
      return { capability, owner };
    });

    const merged = mergeEmployees(
      employees,
      ownerRecords
    );

    return {
      employees: merged,
      sources: Object.fromEntries(
        Object.entries(sources).map(([name, result]) => [
          name,
          {
            ok: result.ok,
            filePath: result.filePath,
            error: result.error
          }
        ])
      )
    };
  }

  all() {
    return this.load().employees;
  }

  capabilityGraph() {
    const graph = {};

    for (const employee of this.all()) {
      const capabilities = employeeCapabilities(employee);

      for (const capability of capabilities) {
        const key = normalize(capability);
        if (!key) continue;

        if (!graph[key]) graph[key] = [];

        graph[key].push({
          employee: employeeName(employee),
          department: employeeDepartment(employee),
          mission: employeeMission(employee),
          authority: employeeAuthority(employee),
          role: employee.role || employee.title || "",
          registrySources:
            employee.registrySources || []
        });
      }
    }

    return graph;
  }

  findByCapability(query) {
    const target = normalize(query);
    const employees = this.all();
    const scored = [];

    for (const employee of employees) {
      const result = scoreEmployee(employee, target);

      if (result.score <= 0) continue;

      scored.push({
        employee: employeeName(employee),
        department: employeeDepartment(employee),
        mission: employeeMission(employee),
        authority: employeeAuthority(employee),
        role: employee.role || employee.title || "",
        score: result.score,
        matchReasons: result.reasons,
        registrySources:
          employee.registrySources || []
      });
    }

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.employee.localeCompare(b.employee);
    });

    return scored.length > 0
      ? [{
          capability: target,
          employees: scored
        }]
      : [];
  }

  resolveBestWorker(capability, fallback = "MILES") {
    const matches = this.findByCapability(capability);
    const workers = matches?.[0]?.employees || [];

    return {
      ok: workers.length > 0,
      capability: normalize(capability),
      worker: workers[0] || null,
      candidates: workers,
      fallback: workers.length > 0 ? null : fallback
    };
  }

  plan(objective) {
    const text = normalize(objective);

    const hints = {
      "website.health.repair":
        /website|b12|site|ssl|dns|web/,
      "website.health.verify":
        /verify website|website audit|website health/,
      "marketing.campaign.audit":
        /instantly|campaign|deliverability|bounce|inbox|email outreach|marketing/,
      "orion.refresh":
        /orion|government data|contractor intelligence|buyer intelligence|opportunity intelligence|recompete|forecast|sources sought|rfi/
    };

    const requiredCapabilities = Object.entries(hints)
      .filter(([, pattern]) => pattern.test(text))
      .map(([capability]) => capability);

    return {
      ok: true,
      objective,
      requiredCapabilities,
      assignments: requiredCapabilities.map(capability => {
        const resolved = this.resolveBestWorker(capability);

        return {
          capability,
          bestWorker: resolved.worker,
          candidates: this.findByCapability(capability)
        };
      })
    };
  }

  status() {
    const loaded = this.load();
    const graph = this.capabilityGraph();

    const canonicalCapabilities = [
      "website.health.repair",
      "website.health.verify",
      "marketing.campaign.audit",
      "orion.refresh",
      "executive.objective.evaluate"
    ];

    return {
      ok: loaded.employees.length > 0,
      employees: loaded.employees.length,
      capabilities: Object.keys(graph).length,
      canonicalResolution: Object.fromEntries(
        canonicalCapabilities.map(capability => {
          const resolution =
            this.resolveBestWorker(capability);

          return [
            capability,
            {
              found: resolution.ok,
              worker:
                resolution.worker?.employee || null,
              score:
                resolution.worker?.score || 0,
              candidateCount:
                resolution.candidates.length
            }
          ];
        })
      ),
      sources: loaded.sources
    };
  }
}

module.exports = new WorkforceService();
'@ | Set-Content -Path $TargetPath -Encoding UTF8

$TestPath = Join-Path $TestDir "Test_Build017_RegistryAwareWorkforce.js"

@'
"use strict";

const assert = require("assert");

process.env.MILES_ROOT =
  process.env.MILES_ROOT ||
  "D:\\P2GC_Intelligence\\MILES_ENTERPRISE";

const workforce =
  require("../SERVICES/WorkforceService");
const capabilityService =
  require("../SERVICES/CapabilityService");
const planner =
  require("../SERVICES/PlannerService");

function main() {
  const status = workforce.status();

  assert(
    status.employees > 0,
    "No employees were loaded from existing MILES registries."
  );

  const website =
    workforce.resolveBestWorker(
      "website.health.repair"
    );

  const marketing =
    workforce.resolveBestWorker(
      "marketing.campaign.audit"
    );

  const orion =
    workforce.resolveBestWorker(
      "orion.refresh"
    );

  const capabilityPlan =
    capabilityService.planObjective(
      "Repair Website: WebsiteProviderLoadFailure"
    );

  const plan =
    planner.createPlan(
      "Repair Website: WebsiteProviderLoadFailure"
    );

  assert.strictEqual(
    plan.steps[0].provider,
    "WebsiteProvider"
  );

  assert.strictEqual(
    plan.steps[0].capability,
    "website.health.repair"
  );

  if (website.ok) {
    assert.notStrictEqual(
      plan.steps[0].assignedTo,
      "MILES",
      "Website worker was resolved but planner still assigned MILES."
    );
  }

  console.log(JSON.stringify({
    ok: true,
    build: "017",
    workforceStatus: status,
    resolutions: {
      website,
      marketing,
      orion
    },
    capabilityAssignment:
      capabilityPlan.assignments?.[0] || null,
    plannerStep:
      plan.steps[0]
  }, null, 2));
}

try {
  main();
} catch (err) {
  console.error(err.stack || err.message);
  process.exit(1);
}
'@ | Set-Content -Path $TestPath -Encoding UTF8

Write-Host ""
Write-Host "=== SYNTAX VALIDATION ==="

$SyntaxFiles = @(
    ".\SERVICES\WorkforceService.js",
    ".\SERVICES\CapabilityService.js",
    ".\SERVICES\PlannerService.js",
    ".\TESTS\Test_Build017_RegistryAwareWorkforce.js"
)

foreach ($File in $SyntaxFiles) {
    & node --check $File

    if ($LASTEXITCODE -ne 0) {
        throw "Syntax validation failed: $File"
    }

    Write-Host "[PASS] $File"
}

Write-Host ""
Write-Host "=== BUILD 017 AUTOMATED TESTS ==="

$TestOutput = & node $TestPath 2>&1
$TestExit = $LASTEXITCODE
$TestReport = Join-Path $ReportDir "build_017_test_$Stamp.txt"

$TestOutput | Tee-Object -FilePath $TestReport

if ($TestExit -ne 0) {
    throw "Build 017 test failure. Restore from: $BackupRoot"
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
    integratedSources = @(
        "CONFIG\WORKFORCE\MILES_WORKFORCE_REGISTRY.json",
        "DATA\runtime\worker_registry.json",
        "DATA\repository\worker_registry.json",
        "DATA\capability\capability_owner_map.json",
        "DATA\capability\capability_execution_map.json"
    )
    preservedServices = @(
        "SERVICES\CapabilityService.js",
        "SERVICES\PlannerService.js",
        "SERVICES\ProviderRouterService.js",
        "SERVICES\WorkflowService.js",
        "SERVICES\WorkPackageService.js",
        "SERVICES\ExecutionService.js",
        "SERVICES\WorkforceExecutionService.js"
    )
    testReport = $TestReport
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
Write-Host "Run the end-to-end workflow test:"
Write-Host 'node -e "const w=require(''./SERVICES/WorkflowService''); console.log(JSON.stringify(w.createWorkflow(''Repair Website: WebsiteProviderLoadFailure''),null,2));"'
Write-Host ""
Write-Host "Then execute the queued task:"
Write-Host 'node -e "const e=require(''./SERVICES/ExecutionService''); e.runNext().then(r=>console.log(JSON.stringify(r,null,2))).catch(err=>{console.error(err);process.exit(1);});"'
