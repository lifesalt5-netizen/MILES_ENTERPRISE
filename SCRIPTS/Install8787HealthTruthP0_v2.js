"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT || process.cwd();
const file = path.join(ROOT, "SERVICES", "digital_coo", "ExecutiveRuntimeHealthService.js");
if (!fs.existsSync(file)) throw new Error(`Missing ${file}`);

let text = fs.readFileSync(file, "utf8");
const original = text;
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0,14);
const backup = `${file}.BEFORE_8787_HEALTH_TRUTH_V2_${stamp}`;
fs.copyFileSync(file, backup);

function findMethodBounds(source, methodName) {
  const re = new RegExp(`\\n\\s{2}(?:async\\s+)?${methodName}\\s*\\([^)]*\\)\\s*\\{`, "m");
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

if (!text.includes("MILES_8787_HEALTH_TRUTH_P0")) {
  const pathRequire = 'const path = require("path");';
  if (!text.includes(pathRequire)) throw new Error("Could not locate path require.");
  text = text.replace(
    pathRequire,
    `${pathRequire}\nconst { execSync } = require("child_process");\n\n// MILES_8787_HEALTH_TRUTH_P0`
  );
}

if (!text.includes("livePm2Runtime()")) {
  const health = findMethodBounds(text, "healthCheck");
  if (!health) throw new Error("Could not locate healthCheck().");
  const helper = `  livePm2Runtime() {\n    try {\n      const raw = execSync(\"pm2 jlist\", {\n        cwd: this.rootDir,\n        encoding: \"utf8\",\n        stdio: [\"ignore\", \"pipe\", \"ignore\"]\n      });\n      const apps = JSON.parse(raw);\n      const expected = [\"miles-worker\", \"miles-ui\", \"miles-dashboard\", \"miles-command-center\"];\n      const byName = new Map(apps.map(app => [app.name, app]));\n      const services = expected.map(name => {\n        const app = byName.get(name);\n        const online = app?.pm2_env?.status === \"online\";\n        return {\n          name,\n          running: online,\n          ready: online,\n          pid: Number(app?.pid || 0) || null,\n          restartCount: Number(app?.pm2_env?.restart_time || 0),\n          memoryMB: Math.round(Number(app?.monit?.memory || 0) / 1024 / 1024)\n        };\n      });\n      const ok = services.every(s => s.running && s.ready && s.pid);\n      return {\n        ok,\n        status: ok ? \"HEALTHY\" : \"DEGRADED\",\n        source: \"PM2_LIVE\",\n        services,\n        serviceCount: services.length,\n        requiredServiceCount: expected.length,\n        readyCount: services.filter(s => s.ready).length,\n        runningCount: services.filter(s => s.running).length,\n        restartCount: services.reduce((n, s) => n + s.restartCount, 0),\n        generatedAt: new Date(this.now()).toISOString()\n      };\n    } catch (error) {\n      return {\n        ok: false,\n        status: \"UNAVAILABLE\",\n        source: \"PM2_LIVE\",\n        error: error.message\n      };\n    }\n  }\n\n`;
  text = text.slice(0, health.start) + helper + text.slice(health.start);
}

const health = findMethodBounds(text, "healthCheck");
if (!health) throw new Error("Could not locate healthCheck() after helper insertion.");
let method = text.slice(health.start, health.end);

if (!method.includes("const liveProductionRuntime = this.livePm2Runtime();")) {
  const componentsIndex = method.indexOf("    const components = {");
  if (componentsIndex < 0) throw new Error("Could not locate components declaration in healthCheck().");
  const componentsOpen = method.indexOf("{", componentsIndex);
  let depth = 0;
  let close = -1;
  for (let i = componentsOpen; i < method.length; i++) {
    if (method[i] === "{") depth++;
    else if (method[i] === "}") {
      depth--;
      if (depth === 0) { close = i; break; }
    }
  }
  if (close < 0) throw new Error("Could not locate components object boundary.");
  const semicolon = method.indexOf(";", close);
  if (semicolon < 0) throw new Error("Could not locate components terminator.");

  const replacement = `    const snapshotProductionRuntime =\n      this.validateProductionRuntime(bootstrapSnapshot);\n    const liveProductionRuntime = this.livePm2Runtime();\n\n    const productionRuntime = liveProductionRuntime.ok\n      ? {\n          ...liveProductionRuntime,\n          snapshotStatus: snapshotProductionRuntime.status || null,\n          snapshotEvidence:\n            snapshotProductionRuntime.evidence ||\n            bootstrapSnapshot.filePath ||\n            null\n        }\n      : snapshotProductionRuntime;\n\n    const components = {\n      productionRuntime,\n      workerRuntime:\n        this.validateWorker(workerSnapshot),\n      queue:\n        this.validateQueue(workerSnapshot),\n      providers:\n        this.validateProviders(workerSnapshot)\n    };`;

  method = method.slice(0, componentsIndex) + replacement + method.slice(semicolon + 1);
  text = text.slice(0, health.start) + method + text.slice(health.end);
}

if (!text.includes("const liveProductionRuntime = this.livePm2Runtime();")) {
  throw new Error("Live PM2 production runtime was not wired into healthCheck().");
}

if (text === original) {
  console.log("=== 8787 HEALTH TRUTH P0 V2 ===");
  console.log("status : ALREADY_INSTALLED");
  process.exit(0);
}

fs.writeFileSync(file, text, "utf8");
console.log("=== 8787 HEALTH TRUTH P0 V2 ===");
console.log("patched:", file);
console.log("backup :", backup);
console.log("change : structural healthCheck patch; live PM2 runtime is authoritative, bootstrap snapshot remains evidence/fallback");
console.log("next   : node --check .\\SERVICES\\digital_coo\\ExecutiveRuntimeHealthService.js");
