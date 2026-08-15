"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT || process.cwd();
const file = path.join(ROOT, "CORE", "TaskQueue.js");
if (!fs.existsSync(file)) throw new Error(`Missing ${file}`);

let text = fs.readFileSync(file, "utf8");
const original = text;
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
const backup = `${file}.BEFORE_PROCESS_WIDE_REENTRANT_LOCK_${stamp}`;
fs.copyFileSync(file, backup);

if (!text.includes("__MILES_TASKQUEUE_PROCESS_LOCKS")) {
  const anchor = "class TaskQueue {";
  const idx = text.indexOf(anchor);
  if (idx < 0) throw new Error("Could not locate TaskQueue class.");
  const injected = `const PROCESS_LOCKS = globalThis.__MILES_TASKQUEUE_PROCESS_LOCKS ||\n  (globalThis.__MILES_TASKQUEUE_PROCESS_LOCKS = new Map());\n\n`;
  text = text.slice(0, idx) + injected + text.slice(idx);
}

function findMethodBounds(source, signature) {
  const start = source.indexOf(signature);
  if (start < 0) return null;
  const brace = source.indexOf("{", start);
  if (brace < 0) return null;
  let depth = 0;
  let quote = null;
  let escape = false;
  for (let i = brace; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (escape) { escape = false; continue; }
      if (ch === "\\") { escape = true; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") { quote = ch; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return { start, end: i + 1 };
    }
  }
  return null;
}

const bounds = findMethodBounds(text, "    withLock(fn) {");
if (!bounds) throw new Error("Could not locate withLock(fn) method structurally.");

const replacement = `    withLock(fn) {\n        const key = path.resolve(this.lockPath);\n        const held = PROCESS_LOCKS.get(key);\n\n        // Reentrant across every TaskQueue instance in this Node process.\n        // This prevents a worker from deadlocking itself when different\n        // services construct separate TaskQueue objects concurrently.\n        if (held && held.pid === process.pid) {\n            held.depth += 1;\n            try {\n                return fn();\n            } finally {\n                held.depth -= 1;\n                if (held.depth <= 0) {\n                    PROCESS_LOCKS.delete(key);\n                }\n            }\n        }\n\n        const locked = this.acquireLock();\n\n        if (!locked) {\n            const owner = this.readLockOwner();\n            const ageMs = this.lockAgeMs();\n            throw new Error(\n                \"TaskQueue lock could not be acquired after timeout. \" +\n                \"lockPath=\" + this.lockPath +\n                \"; ageMs=\" + String(ageMs) +\n                \"; ownerPid=\" + String(owner && owner.pid ? owner.pid : \"unknown\")\n            );\n        }\n\n        PROCESS_LOCKS.set(key, {\n            pid: process.pid,\n            depth: 1,\n            token: this.lockToken\n        });\n\n        try {\n            return fn();\n        } finally {\n            const current = PROCESS_LOCKS.get(key);\n            if (current && current.pid === process.pid) {\n                current.depth -= 1;\n                if (current.depth <= 0) {\n                    PROCESS_LOCKS.delete(key);\n                    this.releaseLock();\n                }\n            } else {\n                this.releaseLock();\n            }\n        }\n    }`;

text = text.slice(0, bounds.start) + replacement + text.slice(bounds.end);

if (text === original) throw new Error("No changes applied.");
fs.writeFileSync(file, text, "utf8");

console.log("=== TASKQUEUE PROCESS-WIDE REENTRANT LOCK P0 ===");
console.log("patched:", file);
console.log("backup :", backup);
console.log("change : shared per-process lock ownership/depth across all TaskQueue instances");
console.log("next   : node --check .\\CORE\\TaskQueue.js");
