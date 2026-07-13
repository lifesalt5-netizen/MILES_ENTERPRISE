const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT || "D:\\P2GC_Intelligence\\MILES_OS";
const REGISTRY_PATH = path.join(ROOT, "CONFIG", "WORKFORCE", "MILES_WORKFORCE_REGISTRY.json");

function normalizeList(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.map(x => String(x).trim()).filter(Boolean);
  return String(v).split(/[,;\n]/).map(x => x.trim()).filter(Boolean);
}

class WorkforceService {
  load() {
    if (!fs.existsSync(REGISTRY_PATH)) {
      return { employees: [], error: `Missing workforce registry: ${REGISTRY_PATH}` };
    }

    const raw = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8"));
    const employees = Array.isArray(raw) ? raw : (raw.employees || raw.workforce || []);

    return { employees };
  }

  all() {
    return this.load().employees;
  }

  capabilityGraph() {
    const graph = {};

    for (const employee of this.all()) {
      const name = employee.name || employee.employee || employee.id || "UNKNOWN";
      const capabilities = normalizeList(employee.capabilities || employee.owns || employee.skills);

      for (const cap of capabilities) {
        const key = cap.toLowerCase();
        if (!graph[key]) graph[key] = [];
        graph[key].push({
          employee: name,
          department: employee.department || "",
          mission: employee.mission || "",
          authority: employee.authority || "Operational"
        });
      }
    }

    return graph;
  }

  findByCapability(query) {
    const q = String(query || "").toLowerCase();
    const graph = this.capabilityGraph();

    const matches = [];

    for (const [capability, employees] of Object.entries(graph)) {
      if (capability.includes(q) || q.includes(capability)) {
        matches.push({ capability, employees });
      }
    }

    return matches;
  }

  plan(objective) {
    const text = String(objective || "").toLowerCase();

    const capabilityHints = [
      "sales",
      "pipeline",
      "forecast",
      "recompete",
      "expiration",
      "capture",
      "proposal",
      "vehicle",
      "pricing",
      "email",
      "marketing",
      "sled",
      "agency",
      "prime",
      "subcontract",
      "past performance",
      "competitive",
      "market intelligence"
    ];

    const required = capabilityHints.filter(c => text.includes(c));
    const assignments = [];

    for (const cap of required) {
      assignments.push({
        capability: cap,
        candidates: this.findByCapability(cap)
      });
    }

    return {
      ok: true,
      objective,
      requiredCapabilities: required,
      assignments
    };
  }

  status() {
    const employees = this.all();
    const graph = this.capabilityGraph();

    return {
      ok: true,
      employees: employees.length,
      capabilities: Object.keys(graph).length,
      registryPath: REGISTRY_PATH
    };
  }
}

module.exports = new WorkforceService();
