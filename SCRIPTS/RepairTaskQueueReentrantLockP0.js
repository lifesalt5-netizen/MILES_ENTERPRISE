"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const file = path.join(root, "CORE", "TaskQueue.js");
const text = fs.readFileSync(file, "utf8");

const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
const backup = `${file}.BEFORE_REENTRANT_LOCK_${stamp}`;
fs.copyFileSync(file, backup);

let out = text;
let changes = 0;

// Add per-instance reentrancy depth next to the existing lock token.
if (!out.includes("this.lockDepth = 0;")) {
  const needle = "        this.lockToken = null;";
  if (!out.includes(needle)) {
    throw new Error("Could not locate this.lockToken initialization in local TaskQueue.js");
  }
  out = out.replace(needle, needle + "\n        this.lockDepth = 0;");
  changes++;
}

// Replace the exact local withLock implementation with a reentrant version.
const startMarker = "    withLock(fn) {";
const endMarker = "\n\n    sanitizeJsonText(text) {";
const start = out.indexOf(startMarker);
const end = out.indexOf(endMarker, start);

if (start < 0 || end < 0) {
  throw new Error("Could not locate local withLock() method boundaries.");
}

const replacement = `    withLock(fn) {\n        // Reentrant within this TaskQueue instance/process.\n        // Nested queue operations must not try to reacquire the same\n        // filesystem lock already owned by this process.\n        if (this.lockDepth > 0) {\n            this.lockDepth += 1;\n            try {\n                return fn();\n            } finally {\n                this.lockDepth -= 1;\n            }\n        }\n\n        const locked = this.acquireLock();\n\n        if (!locked) {\n            const owner = this.readLockOwner();\n            const ageMs = this.lockAgeMs();\n            throw new Error(\n                \"TaskQueue lock could not be acquired after timeout. \" +\n                \"lockPath=\" + this.lockPath +\n                \"; ageMs=\" + String(ageMs) +\n                \"; ownerPid=\" + String(owner && owner.pid ? owner.pid : \"unknown\")\n            );\n        }\n\n        this.lockDepth = 1;\n\n        try {\n            return fn();\n        } finally {\n            this.lockDepth = 0;\n            this.releaseLock();\n        }\n    }`;

out = out.slice(0, start) + replacement + out.slice(end);
changes++;

fs.writeFileSync(file, out, "utf8");

console.log("=== TASKQUEUE REENTRANT LOCK P0 ===");
console.log("patched:", file);
console.log("backup :", backup);
console.log("changes:", changes);
console.log("next   : node --check .\\CORE\\TaskQueue.js");
