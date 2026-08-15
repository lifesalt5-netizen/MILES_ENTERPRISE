"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT || process.cwd();
const file = path.join(ROOT, "SERVICES", "digital_coo", "ExecutiveRuntimeHealthService.js");
if (!fs.existsSync(file)) throw new Error(`Missing ${file}`);

let text = fs.readFileSync(file, "utf8");
const original = text;
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0,14);
const backup = `${file}.BEFORE_8787_HEALTH_TRUTH_${stamp}`;
fs.copyFileSync(file, backup);

if (!text.includes("MILES_8787_HEALTH_TRUTH_P0")) {
  text = text.replace(
    'const path = require("path");',
    'const path = require("path");\nconst { execSync } = require("child_process");\n\n// MILES_8787_HEALTH_TRUTH_P0'
  );

  const anchor = "  async healthCheck() {";
  const idx = text.indexOf(anchor);
  if (idx < 0) throw new Error("Could not locate healthCheck().");

  const helpers = `  livePm2Runtime() {\n    try {\n      const raw = execSync(\"pm2 jlist\", { cwd: this.rootDir, encoding: \"utf8\", stdio:[\"ignore\",\"pipe\",\"ignore\"] });\n      const apps = JSON.parse(raw);\n      const expected = [\"miles-worker\",\"miles-ui\",\"miles-dashboard\",\"miles-command-center\"];\n      const byName = new Map(apps.map(app => [app.name, app]));\n      const services = expected.map(name => {\n        const app = byName.get(name);\n        return {\n          name,\n          running: app?.pm2_env?.status === \"online\",\n          ready: app?.pm2_env?.status === \"online\",\n          pid: Number(app?.pid || 0) || null,\n          restartCount: Number(app?.pm2_env?.restart_time || 0),\n          memoryMB: Math.round(Number(app?.monit?.memory || 0) / 1024 / 1024)\n        };\n      });\n      return {\n        ok: services.every(s => s.running && s.ready && s.pid),\n        status: services.every(s => s.running && s.ready && s.pid) ? \"HEALTHY\" : \"DEGRADED\",\n        source: \"PM2_LIVE\",\n        services,\n        serviceCount: services.length,\n        requiredServiceCount: expected.length,\n        readyCount: services.filter(s => s.ready).length,\n        runningCount: services.filter(s => s.running).length,\n        restartCount: services.reduce((n,s)=>n+s.restartCount,0),\n        generatedAt: new Date(this.now()).toISOString()\n      };\n    } catch (error) {\n      return { ok:false, status:\"UNAVAILABLE\", source:\"PM2_LIVE\", error:error.message };\n    }\n  }\n\n`;
  text = text.slice(0, idx) + helpers + text.slice(idx);
}

const oldBlock = `    const components = {\n      productionRuntime:\n        this.validateProductionRuntime(bootstrapSnapshot),\n      workerRuntime:\n        this.validateWorker(workerSnapshot),\n      queue:\n        this.validateQueue(workerSnapshot),\n      providers:\n        this.validateProviders(workerSnapshot)\n    };`;
const newBlock = `    const snapshotProductionRuntime =\n      this.validateProductionRuntime(bootstrapSnapshot);\n    const liveProductionRuntime = this.livePm2Runtime();\n\n    const productionRuntime = liveProductionRuntime.ok\n      ? {\n          ...liveProductionRuntime,\n          snapshotStatus: snapshotProductionRuntime.status || null,\n          snapshotEvidence: snapshotProductionRuntime.evidence || bootstrapSnapshot.filePath || null\n        }\n      : snapshotProductionRuntime;\n\n    const components = {\n      productionRuntime,\n      workerRuntime:\n        this.validateWorker(workerSnapshot),\n      queue:\n        this.validateQueue(workerSnapshot),\n      providers:\n        this.validateProviders(workerSnapshot)\n    };`;
if (text.includes(oldBlock)) {
  text = text.replace(oldBlock,newBlock);
} else if (!text.includes("const liveProductionRuntime = this.livePm2Runtime();")) {
  throw new Error("Could not locate health components block.");
}

if (text === original) {
  console.log("=== 8787 HEALTH TRUTH P0 ===");
  console.log("status : ALREADY_INSTALLED");
  process.exit(0);
}

fs.writeFileSync(file,text,"utf8");
console.log("=== 8787 HEALTH TRUTH P0 ===");
console.log("patched:",file);
console.log("backup :",backup);
console.log("change : live PM2 state is authoritative for production runtime health; bootstrap snapshot remains evidence/fallback");
console.log("next   : node --check .\\SERVICES\\digital_coo\\ExecutiveRuntimeHealthService.js");
