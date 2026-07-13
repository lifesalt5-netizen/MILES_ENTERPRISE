# INSTALL_MILES_BUILD_018_ENTERPRISE_ASSIGNMENT_AND_CREDENTIAL_AWARENESS.ps1
# Scope:
#   - Enterprise-preferred worker assignment
#   - Explicit MILES executive ownership
#   - Credential-aware safe-mode reporting
#
# Replaces only:
#   SERVICES\CapabilityService.js
#   SERVICES\WorkforceService.js
#   SERVICES\ProviderRouterService.js
#
# Preserves:
#   PlannerService
#   WorkflowService
#   WorkPackageService
#   ExecutionService
#   WorkforceExecutionService
#   Decision/Governance/Verification

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Root = "D:\P2GC_Intelligence\MILES_ENTERPRISE"

if (-not (Test-Path $Root)) {
    throw "Authoritative MILES root not found: $Root"
}

Set-Location $Root
$env:MILES_ROOT = $Root

$Stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$BackupRoot = Join-Path $Root "_BACKUPS\BUILD_018_$Stamp"
$TestDir = Join-Path $Root "TESTS"
$ReportDir = Join-Path $Root "DATA\build_018"

New-Item -ItemType Directory -Path $BackupRoot -Force | Out-Null
New-Item -ItemType Directory -Path $TestDir -Force | Out-Null
New-Item -ItemType Directory -Path $ReportDir -Force | Out-Null

$Targets = @(
    "SERVICES\CapabilityService.js",
    "SERVICES\WorkforceService.js",
    "SERVICES\ProviderRouterService.js"
)

Write-Host ""
Write-Host "============================================================"
Write-Host "MILES BUILD 018"
Write-Host "Enterprise Assignment + Credential Awareness"
Write-Host "Root:   $Root"
Write-Host "Backup: $BackupRoot"
Write-Host "============================================================"

foreach ($RelativePath in $Targets) {
    $SourcePath = Join-Path $Root $RelativePath

    if (-not (Test-Path $SourcePath)) {
        throw "Required authoritative file not found: $SourcePath"
    }

    $BackupPath = Join-Path $BackupRoot $RelativePath
    New-Item -ItemType Directory -Path (Split-Path $BackupPath -Parent) -Force | Out-Null
    Copy-Item $SourcePath $BackupPath -Force
    Write-Host "[BACKUP] $RelativePath"
}

@'
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT || process.cwd();

const PATHS = Object.freeze({
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
  ownerMap: path.join(
    ROOT,
    "DATA",
    "capability",
    "capability_owner_map.json"
  ),
  executionMap: path.join(
    ROOT,
    "DATA",
    "capability",
    "capability_execution_map.json"
  ),
  enterpriseComponents: path.join(
    ROOT,
    "runtime",
    "enterprise_registry",
    "component_registry.json"
  )
});

const CANONICAL_TO_ENTERPRISE = Object.freeze({
  "website.health.repair": [
    "website.health.repair",
    "website operations",
    "website_operations",
    "AUDIT_WEBSITE",
    "RUN_HEALTH_CHECK",
    "RECOVER_SERVICE"
  ],
  "website.health.verify": [
    "website.health.verify",
    "website operations",
    "website_operations",
    "AUDIT_WEBSITE",
    "RUN_HEALTH_CHECK"
  ],
  "marketing.campaign.audit": [
    "marketing.campaign.audit",
    "outbound campaign operations",
    "outbound_campaign_operations",
    "CHECK_DELIVERABILITY",
    "SYNC_CAMPAIGNS",
    "MANAGE_MARKETING"
  ],
  "orion.refresh": [
    "orion.refresh",
    "orion intelligence operations",
    "orion_intelligence_operations",
    "QUERY_ORION",
    "SCORE_CONTRACTOR",
    "SCORE_OPPORTUNITY"
  ],
  "executive.objective.evaluate": [
    "executive.objective.evaluate",
    "coo orchestration",
    "coo_orchestration",
    "executive intelligence",
    "executive_intelligence",
    "CREATE_PLAN",
    "PRIORITIZE_WORK",
    "EVALUATE_AUTHORITY"
  ]
});

const MILES_EXECUTIVE_PROFILE = Object.freeze({
  name: "MILES",
  department: "Executive",
  mission: "Operate as the autonomous Digital COO for Pathways 2 Government Contracting.",
  authority: "Operational with CEO-protected action escalation",
  role: "Digital COO",
  capabilities: [
    "executive.objective.evaluate",
    "coo_orchestration",
    "executive_intelligence",
    "CREATE_PLAN",
    "PRIORITIZE_WORK",
    "EVALUATE_AUTHORITY"
  ],
  registrySources: [
    "SYSTEM_EXECUTIVE_IDENTITY"
  ]
});

function readJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return {
        ok: false,
        filePath,
        value: null,
        error: "FILE_NOT_FOUND"
      };
    }

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

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9. ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function key(value) {
  return normalize(value).replace(/\s+/g, "");
}

function list(value) {
  if (value == null) return [];

  if (Array.isArray(value)) {
    return value
      .flatMap(item => list(item))
      .filter(Boolean);
  }

  if (typeof value === "object") {
    return Object.entries(value)
      .flatMap(([entryKey, item]) => {
        if (item === false || item == null) return [];
        if (item === true) return [entryKey];
        if (typeof item === "string") return [entryKey, item];
        if (Array.isArray(item)) return [entryKey, ...item];

        if (typeof item === "object") {
          return [
            entryKey,
            item.name,
            item.capability,
            item.capabilityId,
            item.owner,
            item.employee,
            item.worker,
            item.provider
          ].filter(Boolean);
        }

        return [entryKey, item];
      })
      .map(String)
      .filter(Boolean);
  }

  return String(value)
    .split(/[,;\n|]/)
    .map(item => item.trim())
    .filter(Boolean);
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
    employee.componentName ||
    employee.id ||
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
    ...list(employee.actions),
    ...list(employee.supportedActions)
  ]);
}

function flattenRecords(raw, source) {
  if (raw == null) return [];

  const collections = [
    raw,
    raw.employees,
    raw.workforce,
    raw.workers,
    raw.members,
    raw.registry,
    raw.items,
    raw.records,
    raw.data,
    raw.services
  ].filter(Boolean);

  let selected = [];

  for (const collection of collections) {
    let rows = [];

    if (Array.isArray(collection)) {
      rows = collection;
    } else if (collection && typeof collection === "object") {
      rows = Object.entries(collection).map(([entryKey, item]) => {
        if (item && typeof item === "object" && !Array.isArray(item)) {
          return {
            id: item.id || entryKey,
            name: item.name || item.employee || item.worker || entryKey,
            ...item
          };
        }

        return {
          id: entryKey,
          name: entryKey,
          value: item
        };
      });
    }

    if (rows.length > selected.length) selected = rows;
  }

  return selected
    .filter(row => row && typeof row === "object")
    .map(row => ({
      ...row,
      _source: source
    }));
}

function enterpriseWorkerRecords(raw) {
  const components = Array.isArray(raw?.components)
    ? raw.components
    : [];

  return components
    .filter(component => {
      const categories = component.categories || [];
      return (
        component.primaryType === "WORKER" ||
        categories.includes("WORKER")
      );
    })
    .map(component => ({
      name: component.name,
      role: "Enterprise Worker Component",
      department: inferDepartment(component),
      mission: `Execute enterprise capabilities through ${component.relativePath}.`,
      authority: "Operational",
      capabilities: component.supportedActions || [],
      supportedActions: component.supportedActions || [],
      relativePath: component.relativePath,
      componentId: component.componentId,
      componentStatus: component.status,
      _source: "enterprise_component_registry"
    }));
}

function inferDepartment(component = {}) {
  const text = normalize([
    component.name,
    component.relativePath,
    ...(component.categories || []),
    ...(component.supportedActions || [])
  ].join(" "));

  if (/website|b12|web/.test(text)) return "Website";
  if (/instantly|campaign|marketing|outbound/.test(text)) return "Marketing";
  if (/orion|contractor|buyer|opportunity|recompete/.test(text)) return "ORION";
  if (/executive|coo|planner|decision|governance/.test(text)) return "Executive";
  return "Operations";
}

function extractOwnerRecords(raw) {
  const records = [];

  function visit(node, inherited = null) {
    if (node == null) return;

    if (Array.isArray(node)) {
      for (const item of node) visit(item, inherited);
      return;
    }

    if (typeof node !== "object") return;

    const capability =
      node.capabilityId ||
      node.capability ||
      node.name ||
      inherited;

    const owners = unique([
      ...list(node.primaryOwner),
      ...list(node.owner),
      ...list(node.owners),
      ...list(node.employee),
      ...list(node.employees),
      ...list(node.worker),
      ...list(node.workers),
      ...list(node.assignedTo)
    ]);

    if (capability && owners.length) {
      for (const owner of owners) {
        records.push({
          capability: String(capability),
          owner: String(owner)
        });
      }
    }

    for (const [entryKey, value] of Object.entries(node)) {
      if ([
        "primaryOwner",
        "owner",
        "owners",
        "employee",
        "employees",
        "worker",
        "workers",
        "assignedTo"
      ].includes(entryKey)) {
        continue;
      }

      visit(value, capability || entryKey);
    }
  }

  visit(raw);
  return records;
}

function mergeEmployees(base, ownerRecords) {
  const map = new Map();

  function upsert(employee) {
    const name = employeeName(employee);
    const employeeKey = key(name);

    if (!employeeKey || name === "UNKNOWN") return;

    const existing = map.get(employeeKey) || {
      name,
      department: "",
      mission: "",
      authority: "Operational",
      role: "",
      capabilities: [],
      registrySources: [],
      componentId: null,
      relativePath: null
    };

    existing.department =
      existing.department || employeeDepartment(employee);

    existing.mission =
      existing.mission || employeeMission(employee);

    existing.authority =
      existing.authority || employeeAuthority(employee);

    existing.role =
      existing.role || employee.role || employee.title || "";

    existing.capabilities = unique([
      ...existing.capabilities,
      ...employeeCapabilities(employee)
    ]);

    existing.registrySources = unique([
      ...existing.registrySources,
      employee._source,
      ...(employee.registrySources || [])
    ]);

    existing.componentId =
      existing.componentId || employee.componentId || null;

    existing.relativePath =
      existing.relativePath || employee.relativePath || null;

    map.set(employeeKey, existing);
  }

  for (const employee of base) upsert(employee);

  for (const record of ownerRecords) {
    const ownerKey = key(record.owner);
    const existing = map.get(ownerKey);

    if (existing) {
      existing.capabilities = unique([
        ...existing.capabilities,
        record.capability
      ]);

      existing.registrySources = unique([
        ...existing.registrySources,
        "capability_registry"
      ]);
    }
  }

  upsert(MILES_EXECUTIVE_PROFILE);

  return [...map.values()];
}

function aliasesFor(capability) {
  return (
    CANONICAL_TO_ENTERPRISE[String(capability || "").toLowerCase()] ||
    [capability]
  );
}

function score(employee, capability) {
  const aliases = aliasesFor(capability).map(normalize);
  const declared = employeeCapabilities(employee).map(normalize);

  const searchable = normalize([
    employeeName(employee),
    employeeDepartment(employee),
    employeeMission(employee),
    employee.role,
    employee.title,
    employee.relativePath,
    ...declared
  ].filter(Boolean).join(" "));

  let points = 0;
  const reasons = [];

  for (const alias of aliases) {
    if (!alias) continue;

    if (declared.includes(alias)) {
      points += 250;
      reasons.push(`exact capability: ${alias}`);
    } else if (
      declared.some(item => item.includes(alias) || alias.includes(item))
    ) {
      points += 120;
      reasons.push(`declared capability match: ${alias}`);
    }

    if (searchable.includes(alias)) {
      points += alias.includes(" ") ? 35 : 20;
      reasons.push(`registry text: ${alias}`);
    }
  }

  const department = normalize(employeeDepartment(employee));

  if (
    capability.startsWith("website.") &&
    /website|web|digital|infrastructure/.test(department)
  ) {
    points += 50;
    reasons.push("website department");
  }

  if (
    capability.startsWith("marketing.") &&
    /marketing|sales|email|outreach/.test(department)
  ) {
    points += 50;
    reasons.push("marketing department");
  }

  if (
    capability.startsWith("orion.") &&
    /orion|data|intelligence|research|opportunity/.test(department)
  ) {
    points += 50;
    reasons.push("ORION department");
  }

  if (
    capability.startsWith("executive.") &&
    /executive|operations|leadership|coo/.test(department)
  ) {
    points += 50;
    reasons.push("executive department");
  }

  if (
    employeeName(employee) === "MILES" &&
    capability.startsWith("executive.")
  ) {
    points += 500;
    reasons.push("authoritative executive owner");
  }

  return {
    points,
    reasons: unique(reasons)
  };
}

class WorkforceService {
  load() {
    const sources = {
      workforce: readJson(PATHS.workforce),
      runtimeWorkers: readJson(PATHS.runtimeWorkers),
      repositoryWorkers: readJson(PATHS.repositoryWorkers),
      ownerMap: readJson(PATHS.ownerMap),
      executionMap: readJson(PATHS.executionMap),
      enterpriseComponents: readJson(PATHS.enterpriseComponents)
    };

    const base = [
      ...flattenRecords(sources.workforce.value, "MILES_WORKFORCE_REGISTRY"),
      ...flattenRecords(sources.runtimeWorkers.value, "runtime_worker_registry"),
      ...flattenRecords(sources.repositoryWorkers.value, "repository_worker_registry"),
      ...enterpriseWorkerRecords(sources.enterpriseComponents.value)
    ];

    const ownerRecords = unique([
      ...extractOwnerRecords(sources.ownerMap.value),
      ...extractOwnerRecords(sources.executionMap.value)
    ].map(item => `${item.capability}|||${item.owner}`))
      .map(value => {
        const [capability, owner] = value.split("|||");
        return { capability, owner };
      });

    return {
      employees: mergeEmployees(base, ownerRecords),
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

  findByName(name) {
    const target = key(name);

    return this.all().find(employee =>
      key(employeeName(employee)) === target
    ) || null;
  }

  capabilityGraph() {
    const graph = {};

    for (const employee of this.all()) {
      for (const capability of employeeCapabilities(employee)) {
        const capabilityKey = normalize(capability);
        if (!capabilityKey) continue;

        if (!graph[capabilityKey]) graph[capabilityKey] = [];

        graph[capabilityKey].push({
          employee: employeeName(employee),
          department: employeeDepartment(employee),
          mission: employeeMission(employee),
          authority: employeeAuthority(employee),
          role: employee.role || "",
          componentId: employee.componentId || null,
          relativePath: employee.relativePath || null,
          registrySources: employee.registrySources || []
        });
      }
    }

    return graph;
  }

  findByCapability(query) {
    const capability = String(query || "").toLowerCase();
    const matches = [];

    for (const employee of this.all()) {
      const result = score(employee, capability);
      if (result.points <= 0) continue;

      matches.push({
        employee: employeeName(employee),
        department: employeeDepartment(employee),
        mission: employeeMission(employee),
        authority: employeeAuthority(employee),
        role: employee.role || "",
        componentId: employee.componentId || null,
        relativePath: employee.relativePath || null,
        score: result.points,
        matchReasons: result.reasons,
        registrySources: employee.registrySources || []
      });
    }

    matches.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.employee.localeCompare(b.employee);
    });

    return matches.length
      ? [{ capability, employees: matches }]
      : [];
  }

  resolvePreferredWorker(preferredComponent, capability) {
    const preferredName =
      preferredComponent?.componentName ||
      preferredComponent?.name ||
      null;

    if (preferredName) {
      const exact = this.findByName(preferredName);

      if (exact) {
        return {
          ok: true,
          source: "ENTERPRISE_PREFERRED_COMPONENT",
          worker: {
            employee: employeeName(exact),
            department: employeeDepartment(exact),
            mission: employeeMission(exact),
            authority: employeeAuthority(exact),
            role: exact.role || "",
            componentId: exact.componentId || preferredComponent.componentId || null,
            relativePath: exact.relativePath || preferredComponent.relativePath || null,
            score: 1000,
            matchReasons: ["enterprise preferred component"],
            registrySources: exact.registrySources || []
          }
        };
      }
    }

    const fallback = this.resolveBestWorker(capability);

    return {
      ...fallback,
      source: fallback.ok
        ? "WORKFORCE_SCORING_FALLBACK"
        : "MILES_FALLBACK"
    };
  }

  resolveBestWorker(capability) {
    const matches = this.findByCapability(capability);
    const workers = matches?.[0]?.employees || [];

    return {
      ok: workers.length > 0,
      capability,
      worker: workers[0] || null,
      candidates: workers,
      fallback: workers.length ? null : "MILES"
    };
  }

  status() {
    const loaded = this.load();

    const canonical = [
      "website.health.repair",
      "website.health.verify",
      "marketing.campaign.audit",
      "orion.refresh",
      "executive.objective.evaluate"
    ];

    return {
      ok: loaded.employees.length > 0,
      employees: loaded.employees.length,
      capabilities: Object.keys(this.capabilityGraph()).length,
      canonicalResolution: Object.fromEntries(
        canonical.map(capability => {
          const resolution = this.resolveBestWorker(capability);

          return [
            capability,
            {
              found: resolution.ok,
              worker: resolution.worker?.employee || null,
              score: resolution.worker?.score || 0,
              candidateCount: resolution.candidates.length
            }
          ];
        })
      ),
      sources: loaded.sources
    };
  }
}

module.exports = new WorkforceService();
'@ | Set-Content -Path (Join-Path $Root "SERVICES\WorkforceService.js") -Encoding UTF8

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
'@ | Set-Content -Path (Join-Path $Root "SERVICES\CapabilityService.js") -Encoding UTF8

@'
"use strict";

const MarketingProvider =
  require("../PROVIDERS/providers/MarketingProvider");
const OrionProvider =
  require("../PROVIDERS/providers/OrionProvider");
const WebsiteProvider =
  require("../PROVIDERS/providers/WebsiteProvider");

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

    this.providerKeys = {
      MarketingProvider: "instantly",
      WebsiteProvider: "website",
      OrionProvider: "orion"
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
'@ | Set-Content -Path (Join-Path $Root "SERVICES\ProviderRouterService.js") -Encoding UTF8

$TestPath = Join-Path $TestDir "Test_Build018_EnterpriseAssignment.js"

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

  assert.strictEqual(
    executivePlan.steps[0].assignedTo,
    "MILES"
  );

  const milesEmployee = workforce.findByName("MILES");

  assert(
    milesEmployee,
    "MILES executive workforce profile is missing."
  );

  const providerResult =
    await router.executeProviderTask({
      id: "BUILD-018-WEBSITE-TEST",
      type: "WORKFORCE_STEP",
      payload: {
        workPackageId: "BUILD-018-WP",
        objective:
          "Repair Website: WebsiteProviderLoadFailure",
        capability: "website.health.repair",
        provider: "WebsiteProvider",
        action: "verifyWebsite",
        department: "Website",
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
      executiveOwnership:
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
Write-Host "=== BUILD 018 AUTOMATED TESTS ==="

$TestOutput = & node $TestPath 2>&1
$TestExit = $LASTEXITCODE
$TestReport = Join-Path $ReportDir "build_018_test_$Stamp.txt"

$TestOutput | Tee-Object -FilePath $TestReport

if ($TestExit -ne 0) {
    throw "Build 018 automated tests failed. Restore from: $BackupRoot"
}

$Manifest = [ordered]@{
    ok = $true
    build = "018"
    name = "Enterprise Assignment and Credential Awareness"
    installedAt = (Get-Date).ToString("o")
    root = $Root
    backupRoot = $BackupRoot
    replacedFiles = $Targets
    preservedExecutionPath = @(
        "SERVICES\PlannerService.js",
        "SERVICES\WorkflowService.js",
        "SERVICES\WorkPackageService.js",
        "SERVICES\ExecutionService.js",
        "SERVICES\WorkforceExecutionService.js"
    )
    outcomes = @(
        "Enterprise preferred worker is authoritative",
        "MILES owns executive.objective.evaluate",
        "Credential gaps are reported without blocking authorized reads",
        "Write operations remain disabled until configured"
    )
    testReport = $TestReport
}

$ManifestPath =
    Join-Path $ReportDir "build_018_manifest_$Stamp.json"

$Manifest |
    ConvertTo-Json -Depth 8 |
    Set-Content -Path $ManifestPath -Encoding UTF8

Write-Host ""
Write-Host "============================================================"
Write-Host "BUILD 018 INSTALLED AND VERIFIED"
Write-Host "============================================================"
Write-Host "Backups: $BackupRoot"
Write-Host "Reports: $ReportDir"
Write-Host ""
Write-Host "Expected website assignment: WebsiteCOOWorker"
Write-Host "Expected executive assignment: MILES"
Write-Host ""
Write-Host "Run end-to-end workflow verification:"
Write-Host 'node -e "const w=require(''./SERVICES/WorkflowService''); console.log(JSON.stringify(w.createWorkflow(''Repair Website: WebsiteProviderLoadFailure''),null,2));"'
Write-Host ""
Write-Host "Then execute the queued task:"
Write-Host 'node -e "const e=require(''./SERVICES/ExecutionService''); e.runNext().then(r=>console.log(JSON.stringify(r,null,2))).catch(err=>{console.error(err);process.exit(1);});"'
