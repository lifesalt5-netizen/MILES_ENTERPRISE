"use strict";

const fs = require("fs");
const path = require("path");
const Module = require("module");

const ROOT = process.env.MILES_ROOT || path.resolve(__dirname, "..");
const GRAPH_FILE = path.join(ROOT, "CONFIG", "PRODUCTION_SYSTEM_GRAPH.json");
const builtins = new Set(Module.builtinModules.concat(Module.builtinModules.map(v => `node:${v}`)));

function normalize(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\.\//, "");
}
function exists(file) { return fs.existsSync(path.join(ROOT, normalize(file))); }
function read(file) { return fs.readFileSync(path.join(ROOT, normalize(file)), "utf8").replace(/^\uFEFF/, ""); }
function resolveRelative(fromFile, specifier) {
  const base = path.resolve(ROOT, path.dirname(normalize(fromFile)), specifier);
  const candidates = [base, `${base}.js`, `${base}.json`, path.join(base, "index.js")];
  for (const candidate of candidates) {
    try { if (fs.statSync(candidate).isFile()) return normalize(path.relative(ROOT, candidate)); } catch {}
  }
  throw new Error(`Unable to resolve ${specifier} from ${fromFile}`);
}
function stripComments(text) {
  return String(text || "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:\"\'])\/\/.*$/gm, "$1");
}
function specs(file) {
  if (!/\.(?:c?js|mjs)$/i.test(file)) return [];
  const text = stripComments(read(file));
  const out = [];
  const patterns = [
    /require\(\s*["']([^"']+)["']\s*\)/g,
    /require\.resolve\(\s*["']([^"']+)["']\s*\)/g,
    /import\(\s*["']([^"']+)["']\s*\)/g,
    /from\s+["']([^"']+)["']/g
  ];
  for (const regex of patterns) {
    let match;
    while ((match = regex.exec(text))) out.push(match[1]);
  }
  return [...new Set(out)];
}
function collect(entryFiles) {
  const pending = entryFiles.map(normalize);
  const files = new Set();
  const packages = new Set();
  const unresolved = [];
  while (pending.length) {
    const file = pending.shift();
    if (files.has(file)) continue;
    if (!exists(file)) { unresolved.push({ from: null, specifier: file, kind: "ENTRY_MISSING" }); continue; }
    files.add(file);
    for (const specifier of specs(file)) {
      if (specifier.startsWith(".")) {
        try {
          const dep = resolveRelative(file, specifier);
          if (!files.has(dep)) pending.push(dep);
        } catch (error) {
          unresolved.push({ from: file, specifier, kind: "RELATIVE_MISSING", error: error.message });
        }
      } else if (!builtins.has(specifier)) {
        packages.add(specifier.split("/")[0].startsWith("@") ? specifier.split("/").slice(0,2).join("/") : specifier.split("/")[0]);
      }
    }
  }
  return { files, packages, unresolved };
}

function main() {
  if (!fs.existsSync(GRAPH_FILE)) throw new Error(`Production graph missing: ${GRAPH_FILE}`);
  const graph = JSON.parse(fs.readFileSync(GRAPH_FILE, "utf8").replace(/^\uFEFF/, ""));
  const roots = [
    ...(graph.surfaces || []).map(x => x.entry),
    ...(graph.acceptanceRoots || []),
    ...(graph.criticalModules || [])
  ].filter(Boolean);
  const closure = collect(roots);
  const missingAssets = (graph.staticAssets || []).filter(file => !exists(file));
  const missingPackages = [];
  for (const pkg of closure.packages) {
    try { require.resolve(pkg, { paths: [ROOT] }); }
    catch { missingPackages.push(pkg); }
  }
  const ok = closure.unresolved.length === 0 && missingAssets.length === 0 && missingPackages.length === 0;
  const result = {
    ok,
    test: "PRODUCTION_DEPENDENCY_GRAPH_P0",
    roots: roots.length,
    sourceClosureFiles: closure.files.size,
    packageDependencies: [...closure.packages].sort(),
    missingPackages: missingPackages.sort(),
    missingAssets,
    unresolved: closure.unresolved,
    releaseGates: graph.releaseGates || [],
    commandExecutionChain: graph.commandExecutionChain || []
  };
  console.log(JSON.stringify(result, null, 2));
  if (!ok) process.exit(1);
}

if (require.main === module) {
  try { main(); }
  catch (error) { console.error(error.stack || error.message); process.exit(1); }
}

module.exports = { normalize, stripComments, resolveRelative, specs, collect };
