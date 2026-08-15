"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT || process.cwd();
const file = path.join(ROOT, "StartProductionSystem.js");
if (!fs.existsSync(file)) throw new Error(`Missing ${file}`);
let text = fs.readFileSync(file, "utf8");
const original = text;
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
const backup = `${file}.BEFORE_STARTUP_MEMORY_PROBE_${stamp}`;
fs.copyFileSync(file, backup);

if (!text.includes("MILES_STARTUP_MEMORY_PROBE_P0")) {
  const anchor = "const eventBus =\n  safeRequire(\n    \"./event-bus/emitter\"\n  );";
  const idx = text.indexOf(anchor);
  if (idx < 0) throw new Error("Could not locate eventBus require anchor.");
  const patch = `\n\n// MILES_STARTUP_MEMORY_PROBE_P0\nfunction startupMemoryProbe(stage) {\n  try {\n    const usage = process.memoryUsage();\n    const sample = {\n      stage,\n      pid: process.pid,\n      sampledAt: new Date().toISOString(),\n      rssMb: Math.round(usage.rss / 1024 / 1024),\n      heapUsedMb: Math.round(usage.heapUsed / 1024 / 1024),\n      heapTotalMb: Math.round(usage.heapTotal / 1024 / 1024),\n      externalMb: Math.round(usage.external / 1024 / 1024),\n      arrayBuffersMb: Math.round((usage.arrayBuffers || 0) / 1024 / 1024),\n      requireCacheEntries: Object.keys(require.cache || {}).length\n    };\n    const dir = path.join(ROOT, \"DATA\", \"runtime_guardian\");\n    fs.mkdirSync(dir, { recursive: true });\n    fs.appendFileSync(path.join(dir, \"startup_memory_probe.jsonl\"), JSON.stringify(sample) + \"\\n\", \"utf8\");\n    console.log(\"[MILES_MEMORY_PROBE]\", JSON.stringify(sample));\n  } catch {}\n}\n\nstartupMemoryProbe(\"after_static_requires\");\n`;
  text = text.slice(0, idx + anchor.length) + patch + text.slice(idx + anchor.length);
}

if (!text.includes('startupMemoryProbe("before_runtime_boot")')) {
  const anchor = "  await runtime.boot();";
  const idx = text.indexOf(anchor);
  if (idx < 0) throw new Error("Could not locate runtime.boot anchor.");
  const replacement = `  startupMemoryProbe(\"before_runtime_boot\");\n  await runtime.boot();\n  startupMemoryProbe(\"after_runtime_boot\");`;
  text = text.replace(anchor, replacement);
}

if (!text.includes('startupMemoryProbe("after_startup_settle")')) {
  const target = "    await delay(\n      STARTUP_SETTLE_MS\n    );";
  if (text.includes(target)) text = text.replace(target, target + `\n\n    startupMemoryProbe(\"after_startup_settle\");`);
}

if (text === original) throw new Error("Startup memory probe already installed or no change required.");
fs.writeFileSync(file, text, "utf8");
console.log("=== STARTUP MEMORY PROBE P0 ===");
console.log("patched:", file);
console.log("backup :", backup);
console.log("output : DATA\\runtime_guardian\\startup_memory_probe.jsonl");
