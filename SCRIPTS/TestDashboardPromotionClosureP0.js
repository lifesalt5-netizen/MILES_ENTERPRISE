"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT || path.resolve(__dirname, "..");
const RUNNER = path.join(ROOT, "SCRIPTS", "RunApprovedMilesEndToEndFinal.ps1");

function normalize(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\.\//, "");
}

function readPromotionManifest() {
  const text = fs.readFileSync(RUNNER, "utf8").replace(/^\uFEFF/, "");
  const start = text.indexOf("$promoteFiles = @(");
  if (start < 0) throw new Error("Promotion manifest not found in final runner.");
  const end = text.indexOf("\n)\n\nforeach ($file in $promoteFiles)", start);
  if (end < 0) throw new Error("Promotion manifest terminator not found in final runner.");
  const block = text.slice(start, end);
  const files = [];
  const regex = /'([^']+)'/g;
  let match;
  while ((match = regex.exec(block))) files.push(normalize(match[1]));
  return new Set(files);
}

function resolveRelative(fromFile, specifier) {
  const base = path.resolve(ROOT, path.dirname(fromFile), specifier);
  const candidates = [base, `${base}.js`, `${base}.json`, path.join(base, "index.js")];
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return normalize(path.relative(ROOT, candidate));
    } catch {}
  }
  throw new Error(`Unable to resolve relative dependency ${specifier} from ${fromFile}`);
}

function relativeRequires(file) {
  const full = path.join(ROOT, file);
  const text = fs.readFileSync(full, "utf8").replace(/^\uFEFF/, "");
  const specs = [];
  const regex = /require\(\s*["']([^"']+)["']\s*\)/g;
  let match;
  while ((match = regex.exec(text))) {
    if (match[1].startsWith(".")) specs.push(match[1]);
  }
  return specs;
}

function collectClosure(entryFiles) {
  const visited = new Set();
  const pending = entryFiles.map(normalize);
  while (pending.length) {
    const file = pending.shift();
    if (visited.has(file)) continue;
    visited.add(file);
    if (!file.endsWith(".js")) continue;
    for (const specifier of relativeRequires(file)) {
      const dep = resolveRelative(file, specifier);
      if (!visited.has(dep)) pending.push(dep);
    }
  }
  return visited;
}

function main() {
  const manifest = readPromotionManifest();
  const dashboardRoots = [
    "StartExecutiveDashboard.js",
    "SERVICES/DashboardServerService.js"
  ];
  const closure = collectClosure(dashboardRoots);
  const publicAssets = [
    "SERVICES/ceo_dashboard/public/index.html",
    "SERVICES/ceo_dashboard/public/ceo.js",
    "SERVICES/ceo_dashboard/public/ceo.css"
  ];
  const required = new Set([...closure, ...publicAssets]);
  const missingFromRepo = [...required].filter(file => !fs.existsSync(path.join(ROOT, file)));
  const missingFromManifest = [...required].filter(file => !manifest.has(file));

  if (missingFromRepo.length || missingFromManifest.length) {
    console.error(JSON.stringify({
      ok: false,
      test: "DASHBOARD_PROMOTION_CLOSURE_P0",
      missingFromRepo,
      missingFromManifest,
      required: [...required].sort()
    }, null, 2));
    process.exit(1);
  }

  console.log(JSON.stringify({
    ok: true,
    test: "DASHBOARD_PROMOTION_CLOSURE_P0",
    promotedDashboardFiles: [...required].sort(),
    count: required.size
  }, null, 2));
}

if (require.main === module) {
  try { main(); }
  catch (error) {
    console.error(error.stack || error.message);
    process.exit(1);
  }
}

module.exports = { normalize, readPromotionManifest, resolveRelative, relativeRequires, collectClosure };
