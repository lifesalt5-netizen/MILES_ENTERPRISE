"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT || process.cwd();
const file = path.join(ROOT, "SERVICES", "WorkforceService.js");
if (!fs.existsSync(file)) throw new Error(`Missing ${file}`);

let text = fs.readFileSync(file, "utf8");
const original = text;
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
const backup = `${file}.BEFORE_WORKFORCE_MEMORY_CACHE_${stamp}`;
fs.copyFileSync(file, backup);

if (!text.includes("MILES_WORKFORCE_MEMORY_CACHE_P0")) {
  text = text.replace(
    "class WorkforceService {\n  load() {",
    `class WorkforceService {\n  constructor() {\n    // MILES_WORKFORCE_MEMORY_CACHE_P0\n    // Workforce registries are large. Re-reading/flattening them repeatedly during\n    // Supervisor heartbeat and capability resolution caused multi-GB heap growth.\n    this._cache = null;\n    this._cacheSignature = null;\n  }\n\n  sourceSignature() {\n    const parts = [];\n    for (const filePath of Object.values(PATHS)) {\n      try {\n        const stat = fs.statSync(filePath);\n        parts.push(filePath + \"|\" + stat.size + \"|\" + stat.mtimeMs);\n      } catch {\n        parts.push(filePath + \"|missing\");\n      }\n    }\n    return parts.join(\"||\");\n  }\n\n  invalidateCache() {\n    this._cache = null;\n    this._cacheSignature = null;\n  }\n\n  load() {\n    const signature = this.sourceSignature();\n    if (this._cache && this._cacheSignature === signature) {\n      return this._cache;\n    }`
  );

  const returnBlock = `    return {\n      employees: mergeEmployees(base, ownerRecords),\n      sources: Object.fromEntries(\n        Object.entries(sources).map(([name, result]) => [\n          name,\n          {\n            ok: result.ok,\n            filePath: result.filePath,\n            error: result.error\n          }\n        ])\n      )\n    };`;

  const replacement = `    const loaded = {\n      employees: mergeEmployees(base, ownerRecords),\n      sources: Object.fromEntries(\n        Object.entries(sources).map(([name, result]) => [\n          name,\n          {\n            ok: result.ok,\n            filePath: result.filePath,\n            error: result.error\n          }\n        ])\n      )\n    };\n\n    this._cache = loaded;\n    this._cacheSignature = signature;\n    return loaded;`;

  if (!text.includes(returnBlock)) throw new Error("Could not locate WorkforceService load return block.");
  text = text.replace(returnBlock, replacement);
}

if (!text.includes("capabilityGraphFromEmployees")) {
  text = text.replace(
    "  capabilityGraph() {\n    const graph = {};\n\n    for (const employee of this.all()) {",
    `  capabilityGraphFromEmployees(employees) {\n    const graph = {};\n\n    for (const employee of employees) {`
  );

  text = text.replace(
    "    return graph;\n  }\n\n  findByCapability(query) {",
    `    return graph;\n  }\n\n  capabilityGraph() {\n    return this.capabilityGraphFromEmployees(this.all());\n  }\n\n  findByCapability(query) {`
  );

  text = text.replace(
    "      capabilities: Object.keys(this.capabilityGraph()).length,",
    "      capabilities: Object.keys(this.capabilityGraphFromEmployees(loaded.employees)).length,"
  );
}

if (text === original) throw new Error("Workforce memory cache already installed or no change required.");
fs.writeFileSync(file, text, "utf8");

console.log("=== WORKFORCE SERVICE MEMORY CACHE P0 ===");
console.log("patched:", file);
console.log("backup :", backup);
console.log("change : cache large workforce registries by file signature; avoid repeated reload/flatten during heartbeat/status/capability resolution");
console.log("next   : node --check .\\SERVICES\\WorkforceService.js");
