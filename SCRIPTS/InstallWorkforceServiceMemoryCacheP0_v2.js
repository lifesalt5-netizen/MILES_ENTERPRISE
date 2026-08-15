"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT || process.cwd();
const file = path.join(ROOT, "SERVICES", "WorkforceService.js");
if (!fs.existsSync(file)) throw new Error(`Missing ${file}`);

let text = fs.readFileSync(file, "utf8");
const original = text;
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
const backup = `${file}.BEFORE_WORKFORCE_MEMORY_CACHE_V2_${stamp}`;
fs.copyFileSync(file, backup);

function findMethodBounds(source, methodName) {
  const re = new RegExp(`\\n\\s{2}${methodName}\\s*\\([^)]*\\)\\s*\\{`, "m");
  const match = re.exec(source);
  if (!match) return null;
  const start = match.index + 1;
  const open = source.indexOf("{", match.index);
  let depth = 0;
  let quote = null;
  let escape = false;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (escape) { escape = false; continue; }
      if (ch === "\\") { escape = true; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return { start, open, end: i + 1 };
    }
  }
  return null;
}

if (!text.includes("MILES_WORKFORCE_MEMORY_CACHE_P0")) {
  const load = findMethodBounds(text, "load");
  if (!load) throw new Error("Could not locate WorkforceService.load().");

  const helpers = `  constructor() {\n    // MILES_WORKFORCE_MEMORY_CACHE_P0\n    // Large workforce/capability registries are immutable between file changes.\n    // Cache their parsed/flattened form so heartbeat/status resolution does not\n    // repeatedly allocate hundreds of MB inside a single worker process.\n    this._cache = null;\n    this._cacheSignature = null;\n  }\n\n  sourceSignature() {\n    const parts = [];\n    for (const filePath of Object.values(PATHS)) {\n      try {\n        const stat = fs.statSync(filePath);\n        parts.push(filePath + "|" + stat.size + "|" + stat.mtimeMs);\n      } catch {\n        parts.push(filePath + "|missing");\n      }\n    }\n    return parts.join("||");\n  }\n\n  invalidateCache() {\n    this._cache = null;\n    this._cacheSignature = null;\n  }\n\n`;
  text = text.slice(0, load.start) + helpers + text.slice(load.start);

  const load2 = findMethodBounds(text, "load");
  if (!load2) throw new Error("Could not relocate WorkforceService.load() after helper insertion.");
  const method = text.slice(load2.start, load2.end);
  const brace = method.indexOf("{");
  let patched = method.slice(0, brace + 1) + `\n    const signature = this.sourceSignature();\n    if (this._cache && this._cacheSignature === signature) {\n      return this._cache;\n    }` + method.slice(brace + 1);

  const returnPos = patched.lastIndexOf("    return {");
  if (returnPos < 0) throw new Error("Could not locate final load() return object.");
  const returnOpen = patched.indexOf("{", returnPos);
  let depth = 0;
  let returnClose = -1;
  for (let i = returnOpen; i < patched.length; i++) {
    if (patched[i] === "{") depth++;
    else if (patched[i] === "}") {
      depth--;
      if (depth === 0) { returnClose = i; break; }
    }
  }
  if (returnClose < 0) throw new Error("Could not locate load() return object boundary.");
  const objectText = patched.slice(returnOpen, returnClose + 1);
  const semicolon = patched.indexOf(";", returnClose);
  if (semicolon < 0) throw new Error("Could not locate load() return terminator.");
  const replacement = `    const loaded = ${objectText};\n\n    this._cache = loaded;\n    this._cacheSignature = signature;\n    return loaded;`;
  patched = patched.slice(0, returnPos) + replacement + patched.slice(semicolon + 1);
  text = text.slice(0, load2.start) + patched + text.slice(load2.end);
}

// Avoid re-entering load() just to build the graph after status() already loaded it.
if (!text.includes("capabilityGraphFromEmployees(employees)")) {
  const graph = findMethodBounds(text, "capabilityGraph");
  if (!graph) throw new Error("Could not locate capabilityGraph().");
  let method = text.slice(graph.start, graph.end);
  method = method
    .replace(/^\s{2}capabilityGraph\(\)/, "  capabilityGraphFromEmployees(employees)")
    .replace("for (const employee of this.all())", "for (const employee of employees)");
  const wrapper = `${method}\n\n  capabilityGraph() {\n    return this.capabilityGraphFromEmployees(this.all());\n  }`;
  text = text.slice(0, graph.start) + wrapper + text.slice(graph.end);
}

text = text.replace(
  /capabilities:\s*Object\.keys\(this\.capabilityGraph\(\)\)\.length,/,
  "capabilities: Object.keys(this.capabilityGraphFromEmployees(loaded.employees)).length,"
);

if (text === original) throw new Error("Workforce memory cache already installed or no change required.");
fs.writeFileSync(file, text, "utf8");

console.log("=== WORKFORCE SERVICE MEMORY CACHE P0 V2 ===");
console.log("patched:", file);
console.log("backup :", backup);
console.log("change : cache parsed workforce registries by source signature and reuse loaded employees during status graph construction");
console.log("next   : node --check .\\SERVICES\\WorkforceService.js");
