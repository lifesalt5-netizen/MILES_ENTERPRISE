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
    "PRIORITIZE_WORK"
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
      value: JSON.parse(
        fs.readFileSync(filePath, "utf8")
      ),
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
        if (item === false || item == null) {
          return [];
        }

        if (item === true) return [entryKey];

        if (typeof item === "string") {
          return [entryKey, item];
        }

        if (Array.isArray(item)) {
          return [entryKey, ...item];
        }

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
    ...list(employee.actions)
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
    } else if (
      collection &&
      typeof collection === "object"
    ) {
      rows = Object.entries(collection).map(
        ([entryKey, item]) => {
          if (
            item &&
            typeof item === "object" &&
            !Array.isArray(item)
          ) {
            return {
              id: item.id || entryKey,
              name:
                item.name ||
                item.employee ||
                item.worker ||
                entryKey,
              ...item
            };
          }

          return {
            id: entryKey,
            name: entryKey,
            value: item
          };
        }
      );
    }

    if (rows.length > selected.length) {
      selected = rows;
    }
  }

  return selected
    .filter(
      row =>
        row &&
        typeof row === "object"
    )
    .map(row => ({
      ...row,
      _source: source
    }));
}

function extractOwnerRecords(raw) {
  const records = [];

  function visit(node, inherited = null) {
    if (node == null) return;

    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item, inherited);
      }
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

    if (
      !employeeKey ||
      name === "UNKNOWN" ||
      /^unknown$/i.test(name)
    ) {
      return;
    }

    const existing =
      map.get(employeeKey) || {
        name,
        department: "",
        mission: "",
        authority: "Operational",
        role: "",
        capabilities: [],
        registrySources: []
      };

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
      employee._source
    ]);

    map.set(employeeKey, existing);
  }

  for (const employee of base) {
    upsert(employee);
  }

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

  return [...map.values()];
}

function aliasesFor(capability) {
  return (
    CANONICAL_TO_ENTERPRISE[
      String(capability || "").toLowerCase()
    ] || [capability]
  );
}

function score(employee, capability) {
  const aliases = aliasesFor(capability)
    .map(normalize);

  const declared =
    employeeCapabilities(employee)
      .map(normalize);

  const searchable = normalize([
    employeeName(employee),
    employeeDepartment(employee),
    employeeMission(employee),
    employee.role,
    employee.title,
    ...declared
  ].filter(Boolean).join(" "));

  let points = 0;
  const reasons = [];

  for (const alias of aliases) {
    if (!alias) continue;

    if (declared.includes(alias)) {
      points += 250;
      reasons.push(
        `exact capability: ${alias}`
      );
    } else if (
      declared.some(
        item =>
          item.includes(alias) ||
          alias.includes(item)
      )
    ) {
      points += 120;
      reasons.push(
        `declared capability match: ${alias}`
      );
    }

    if (searchable.includes(alias)) {
      points += alias.includes(" ") ? 35 : 20;
      reasons.push(`registry text: ${alias}`);
    }
  }

  const department =
    normalize(employeeDepartment(employee));

  if (
    capability.startsWith("website.") &&
    /website|web|digital|infrastructure/.test(
      department
    )
  ) {
    points += 50;
    reasons.push("website department");
  }

  if (
    capability.startsWith("marketing.") &&
    /marketing|sales|email|outreach/.test(
      department
    )
  ) {
    points += 50;
    reasons.push("marketing department");
  }

  if (
    capability.startsWith("orion.") &&
    /orion|data|intelligence|research|opportunity/.test(
      department
    )
  ) {
    points += 50;
    reasons.push("ORION department");
  }

  if (
    capability.startsWith("executive.") &&
    /executive|operations|leadership|coo/.test(
      department
    )
  ) {
    points += 50;
    reasons.push("executive department");
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
      runtimeWorkers:
        readJson(PATHS.runtimeWorkers),
      repositoryWorkers:
        readJson(PATHS.repositoryWorkers),
      ownerMap: readJson(PATHS.ownerMap),
      executionMap:
        readJson(PATHS.executionMap)
    };

    const base = [
      ...flattenRecords(
        sources.workforce.value,
        "MILES_WORKFORCE_REGISTRY"
      ),
      ...flattenRecords(
        sources.runtimeWorkers.value,
        "runtime_worker_registry"
      ),
      ...flattenRecords(
        sources.repositoryWorkers.value,
        "repository_worker_registry"
      )
    ];

    const ownerRecords = unique([
      ...extractOwnerRecords(
        sources.ownerMap.value
      ),
      ...extractOwnerRecords(
        sources.executionMap.value
      )
    ].map(
      item =>
        `${item.capability}|||${item.owner}`
    )).map(value => {
      const [capability, owner] =
        value.split("|||");

      return { capability, owner };
    });

    return {
      employees:
        mergeEmployees(base, ownerRecords),
      sources: Object.fromEntries(
        Object.entries(sources).map(
          ([name, result]) => [
            name,
            {
              ok: result.ok,
              filePath: result.filePath,
              error: result.error
            }
          ]
        )
      )
    };
  }

  all() {
    return this.load().employees;
  }

  capabilityGraph() {
    const graph = {};

    for (const employee of this.all()) {
      for (
        const capability
        of employeeCapabilities(employee)
      ) {
        const capabilityKey =
          normalize(capability);

        if (!capabilityKey) continue;

        if (!graph[capabilityKey]) {
          graph[capabilityKey] = [];
        }

        graph[capabilityKey].push({
          employee: employeeName(employee),
          department:
            employeeDepartment(employee),
          mission: employeeMission(employee),
          authority:
            employeeAuthority(employee),
          role: employee.role || "",
          registrySources:
            employee.registrySources || []
        });
      }
    }

    return graph;
  }

  findByCapability(query) {
    const capability =
      String(query || "").toLowerCase();

    const matches = [];

    for (const employee of this.all()) {
      const result =
        score(employee, capability);

      if (result.points <= 0) continue;

      matches.push({
        employee: employeeName(employee),
        department:
          employeeDepartment(employee),
        mission: employeeMission(employee),
        authority:
          employeeAuthority(employee),
        role: employee.role || "",
        score: result.points,
        matchReasons: result.reasons,
        registrySources:
          employee.registrySources || []
      });
    }

    matches.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }

      return a.employee.localeCompare(
        b.employee
      );
    });

    return matches.length
      ? [{
          capability,
          employees: matches
        }]
      : [];
  }

  resolveBestWorker(capability) {
    const matches =
      this.findByCapability(capability);

    const workers =
      matches?.[0]?.employees || [];

    return {
      ok: workers.length > 0,
      capability,
      worker: workers[0] || null,
      candidates: workers,
      fallback:
        workers.length ? null : "MILES"
    };
  }

  plan(objective) {
    const text =
      String(objective || "").toLowerCase();

    const hints = {
      "website.health.repair":
        /website|b12|site|ssl|dns/,
      "website.health.verify":
        /verify website|website audit|website health/,
      "marketing.campaign.audit":
        /instantly|campaign|deliverability|bounce|inbox|email outreach|marketing/,
      "orion.refresh":
        /orion|government data|contractor intelligence|buyer intelligence|opportunity intelligence|recompete|forecast|sources sought|rfi/
    };

    const requiredCapabilities =
      Object.entries(hints)
        .filter(([, pattern]) =>
          pattern.test(text)
        )
        .map(([capability]) => capability);

    return {
      ok: true,
      objective,
      requiredCapabilities,
      assignments:
        requiredCapabilities.map(
          capability => {
            const resolution =
              this.resolveBestWorker(
                capability
              );

            return {
              capability,
              bestWorker:
                resolution.worker,
              candidates:
                this.findByCapability(
                  capability
                )
            };
          }
        )
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
      capabilities:
        Object.keys(
          this.capabilityGraph()
        ).length,
      canonicalResolution:
        Object.fromEntries(
          canonical.map(capability => {
            const resolution =
              this.resolveBestWorker(
                capability
              );

            return [
              capability,
              {
                found: resolution.ok,
                worker:
                  resolution.worker?.employee ||
                  null,
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
