"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT || process.cwd();
const file = path.join(ROOT, "StartProductionSystem.js");
if (!fs.existsSync(file)) throw new Error(`Missing ${file}`);
let text = fs.readFileSync(file, "utf8");
const original = text;
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
const backup = `${file}.BEFORE_STARTUP_MEMORY_PROBE_V2_${stamp}`;
fs.copyFileSync(file, backup);

const helper = `\n\n// MILES_STARTUP_MEMORY_PROBE_P0\nfunction startupMemoryProbe(stage) {\n  try {\n    const usage = process.memoryUsage();\n    const sample = {\n      stage,\n      pid: process.pid,\n      sampledAt: new Date().toISOString(),\n      rssMb: Math.round(usage.rss / 1024 / 1024),\n      heapUsedMb: Math.round(usage.heapUsed / 1024 / 1024),\n      heapTotalMb: Math.round(usage.heapTotal / 1024 / 1024),\n      externalMb: Math.round(usage.external / 1024 / 1024),\n      arrayBuffersMb: Math.round((usage.arrayBuffers || 0) / 1024 / 1024),\n      requireCacheEntries: Object.keys(require.cache || {}).length\n    };\n    const dir = path.join(ROOT, \"DATA\", \"runtime_guardian\");\n    fs.mkdirSync(dir, { recursive: true });\n    fs.appendFileSync(path.join(dir, \"startup_memory_probe.jsonl\"), JSON.stringify(sample) + \"\\n\", \"utf8\");\n    console.log(\"[MILES_MEMORY_PROBE]\", JSON.stringify(sample));\n  } catch {}\n}\n`;

if (!text.includes("MILES_STARTUP_MEMORY_PROBE_P0")) {
  const functionAnchor = "function positiveNumber(";
  const idx = text.indexOf(functionAnchor);
  if (idx < 0) throw new Error("Could not locate positiveNumber function anchor.");
  text = text.slice(0, idx) + helper + "\n" + text.slice(idx);
}

if (!text.includes('startupMemoryProbe("after_static_requires")')) {
  const anchor = "function positiveNumber(";
  const idx = text.indexOf(anchor);
  if (idx < 0) throw new Error("Could not locate positiveNumber function anchor for static require probe.");
  text = text.slice(0, idx) + 'startupMemoryProbe("after_static_requires");\n\n' + text.slice(idx);
}

if (!text.includes('startupMemoryProbe("before_runtime_boot")')) {
  const anchor = "  await runtime.boot();";
  if (!text.includes(anchor)) throw new Error("Could not locate runtime.boot anchor.");
  text = text.replace(anchor, '  startupMemoryProbe("before_runtime_boot");\n  await runtime.boot();\n  startupMemoryProbe("after_runtime_boot");');
}

if (!text.includes('startupMemoryProbe("after_startup_settle")')) {
  const settleRegex = /await\s+delay\(\s*STARTUP_SETTLE_MS\s*\);/m;
  if (settleRegex.test(text)) {
    text = text.replace(settleRegex, match => match + '\n\n    startupMemoryProbe("after_startup_settle");');
  }
}

if (text === original) throw new Error("Startup memory probe already installed or no change required.");
fs.writeFileSync(file, text, "utf8");
console.log("=== STARTUP MEMORY PROBE P0 V2 ===");
console.log("patched:", file);
console.log("backup :", backup);
console.log("output : DATA\\runtime_guardian\\startup_memory_probe.jsonl");
console.log("next   : node --check .\\StartProductionSystem.js");
