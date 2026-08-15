"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT || process.cwd();
const file = path.join(ROOT, "StartProductionSystem.js");
if (!fs.existsSync(file)) throw new Error(`Missing ${file}`);
let text = fs.readFileSync(file, "utf8");
const original = text;
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
const backup = `${file}.BEFORE_MEMORY_WATCHDOG_${stamp}`;
fs.copyFileSync(file, backup);

if (!text.includes("MILES_WORKER_MEMORY_WATCHDOG_P0")) {
  const anchor = "  await runtime.boot();";
  const idx = text.indexOf(anchor);
  if (idx < 0) throw new Error("Could not locate runtime.boot() anchor.");
  const patch = `\n\n  // MILES_WORKER_MEMORY_WATCHDOG_P0\n  // Containment + telemetry: PM2 can restart the worker cleanly instead of\n  // allowing runaway RSS to destabilize the Windows host.\n  const memoryWarnMb = Math.max(256, Number(process.env.MILES_WORKER_MEMORY_WARN_MB || 2048));\n  const memoryHardMb = Math.max(memoryWarnMb + 256, Number(process.env.MILES_WORKER_MEMORY_HARD_MB || 3072));\n  const memoryCheckMs = Math.max(10000, Number(process.env.MILES_WORKER_MEMORY_CHECK_MS || 30000));\n  const memoryConsecutiveLimit = Math.max(1, Number(process.env.MILES_WORKER_MEMORY_CONSECUTIVE_LIMIT || 3));\n  let memoryHardSamples = 0;\n\n  const memoryDir = path.join(ROOT, \"DATA\", \"runtime_guardian\");\n  fs.mkdirSync(memoryDir, { recursive: true });\n\n  setInterval(() => {\n    try {\n      const usage = process.memoryUsage();\n      const rssMb = Math.round(usage.rss / 1024 / 1024);\n      const heapUsedMb = Math.round(usage.heapUsed / 1024 / 1024);\n      const heapTotalMb = Math.round(usage.heapTotal / 1024 / 1024);\n      const externalMb = Math.round(usage.external / 1024 / 1024);\n      const sample = {\n        service: \"miles-worker\",\n        pid: process.pid,\n        sampledAt: now(),\n        rssMb,\n        heapUsedMb,\n        heapTotalMb,\n        externalMb,\n        warnMb: memoryWarnMb,\n        hardMb: memoryHardMb\n      };\n      fs.writeFileSync(\n        path.join(memoryDir, \"worker_memory_latest.json\"),\n        JSON.stringify(sample, null, 2),\n        \"utf8\"\n      );\n\n      if (rssMb >= memoryWarnMb) {\n        console.error(\"[MILES] MEMORY WARNING rssMB=\" + rssMb + \" heapUsedMB=\" + heapUsedMb);\n      }\n\n      if (rssMb >= memoryHardMb) {\n        memoryHardSamples += 1;\n      } else {\n        memoryHardSamples = 0;\n      }\n\n      if (memoryHardSamples >= memoryConsecutiveLimit) {\n        const event = { ...sample, action: \"PM2_RECYCLE_REQUESTED\", hardSamples: memoryHardSamples };\n        fs.writeFileSync(\n          path.join(memoryDir, \"worker_memory_recycle_\" + Date.now() + \".json\"),\n          JSON.stringify(event, null, 2),\n          \"utf8\"\n        );\n        console.error(\"[MILES] MEMORY HARD LIMIT reached; exiting for governed PM2 recycle.\");\n        process.exit(86);\n      }\n    } catch (memoryError) {\n      console.error(\"[MILES] MEMORY WATCHDOG ERROR\", memoryError && memoryError.message ? memoryError.message : memoryError);\n    }\n  }, memoryCheckMs).unref();\n`;
  text = text.slice(0, idx + anchor.length) + patch + text.slice(idx + anchor.length);
}

if (text === original) throw new Error("Memory watchdog already installed or no change required.");
fs.writeFileSync(file, text, "utf8");
console.log("=== MILES WORKER MEMORY WATCHDOG P0 ===");
console.log("patched:", file);
console.log("backup :", backup);
console.log("limits : warn=2048MB hard=3072MB x3 samples by default");
console.log("telemetry: DATA\\runtime_guardian\\worker_memory_latest.json");
console.log("next   : node --check .\\StartProductionSystem.js");
