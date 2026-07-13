"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ENTERPRISE_ROOT || process.cwd();
const OUT = path.join(ROOT, "DATA", "enterprise_inventory");

const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  "BACKUPS",
  "backup",
  "dist",
  "build",
  ".next"
]);

function now() {
  return new Date().toISOString();
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files;

  for (const item of fs.readdirSync(dir)) {
    const full = path.join(dir, item);

    try {
      const stat = fs.statSync(full);

      if (stat.isDirectory()) {
        if (!IGNORE_DIRS.has(item)) walk(full, files);
      } else if (item.endsWith(".js")) {
        files.push(full);
      }
    } catch {}
  }

  return files;
}

function rel(file) {
  return path.relative(ROOT, file).replace(/\\/g, "/");
}

function read(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function extractRequires(text) {
  const out = [];
  const rx = /require\(["']([^"']+)["']\)/g;
  let m;
  while ((m = rx.exec(text))) out.push(m[1]);
  return [...new Set(out)];
}

function extractClasses(text) {
  const out = [];
  const rx = /class\s+([A-Za-z0-9_]+)/g;
  let m;
  while ((m = rx.exec(text))) out.push(m[1]);
  return [...new Set(out)];
}

function detectExports(text) {
  const exports = [];

  if (/module\.exports\s*=/.test(text)) exports.push("module.exports");
  if (/exports\.[A-Za-z0-9_]+\s*=/.test(text)) exports.push("named exports");
  if (/module\.exports\s*=\s*new\s+/.test(text)) exports.push("singleton instance");
  if (/module\.exports\s*=\s*\{/.test(text)) exports.push("object export");

  return [...new Set(exports)];
}

function detectRole(file, text) {
  const p = rel(file).toLowerCase();

  if (p.includes("connector")) return "Connector";
  if (p.includes("provider")) return "Provider";
  if (p.includes("worker")) return "Worker";
  if (p.includes("service")) return "Service";
  if (p.includes("engine")) return "Engine";
  if (p.includes("queue")) return "Queue";
  if (p.includes("registry")) return "Registry";
  if (p.includes("router")) return "Router";
  if (p.includes("controller")) return "Controller";
  if (p.includes("start")) return "Startup";
  if (p.includes("logger")) return "Logger";
  if (p.includes("eventbus")) return "EventBus";

  if (/class .*Provider/.test(text)) return "Provider";
  if (/class .*Worker/.test(text)) return "Worker";
  if (/class .*Service/.test(text)) return "Service";
  if (/class .*Engine/.test(text)) return "Engine";

  return "Unknown";
}

function duplicateKey(file) {
  return path.basename(file).toLowerCase();
}

function main() {
  ensureDir(OUT);

  const files = walk(ROOT);
  const records = files.map(file => {
    const text = read(file);

    return {
      file: rel(file),
      role: detectRole(file, text),
      classes: extractClasses(text),
      requires: extractRequires(text),
      exports: detectExports(text),
      lines: text.split(/\r?\n/).length,
      sizeBytes: fs.statSync(file).size
    };
  });

  const byName = {};
  for (const r of records) {
    const key = duplicateKey(r.file);
    byName[key] = byName[key] || [];
    byName[key].push(r.file);
  }

  const duplicates = Object.entries(byName)
    .filter(([_, files]) => files.length > 1)
    .map(([name, files]) => ({ name, count: files.length, files }));

  const roles = {};
  for (const r of records) {
    roles[r.role] = (roles[r.role] || 0) + 1;
  }

  const startupFiles = records.filter(r =>
    /(^|\/)(start|run|launch|bootstrap)/i.test(path.basename(r.file))
  );

  const coreRisks = duplicates.filter(d =>
    /logger|eventbus|taskqueue|queue|approval|registry|router|dispatcher|execution/i.test(d.name)
  );

  const summary = {
    generatedAt: now(),
    root: ROOT,
    totals: {
      jsFiles: records.length,
      duplicateNames: duplicates.length,
      coreRiskDuplicates: coreRisks.length
    },
    roles,
    startupFiles: startupFiles.map(s => s.file),
    coreRiskDuplicates: coreRisks
  };

  fs.writeFileSync(path.join(OUT, "repository_inventory.json"), JSON.stringify(records, null, 2));
  fs.writeFileSync(path.join(OUT, "duplicate_files.json"), JSON.stringify(duplicates, null, 2));
  fs.writeFileSync(path.join(OUT, "inventory_summary.json"), JSON.stringify(summary, null, 2));

  console.log("");
  console.log("=====================================");
  console.log("MILES ENTERPRISE INVENTORY COMPLETE");
  console.log("=====================================");
  console.log(JSON.stringify(summary, null, 2));
  console.log("=====================================");
}

main();
