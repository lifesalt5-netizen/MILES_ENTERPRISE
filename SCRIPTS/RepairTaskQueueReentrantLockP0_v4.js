"use strict";

const fs = require("fs");
const path = require("path");

const root = process.cwd();
const file = path.join(root, "CORE", "TaskQueue.js");
const original = fs.readFileSync(file, "utf8");
let text = original;
let changes = 0;

function backup() {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const backupPath = `${file}.BEFORE_REENTRANT_V4_${stamp}`;
  fs.copyFileSync(file, backupPath);
  return backupPath;
}

// 1) Add lockDepth immediately after the lockToken assignment in constructor.
if (!text.includes("this.lockDepth = 0;")) {
  const tokenNeedle = "        this.lockToken = null;";
  if (!text.includes(tokenNeedle)) {
    throw new Error("Could not locate constructor lockToken assignment.");
  }
  text = text.replace(tokenNeedle, tokenNeedle + "\n        this.lockDepth = 0;");
  changes++;
}

// 2) Guard constructor startup locking so existing queues do not contend during module load.
const constructorOld = `        this.ensureRuntime();\n        this.withLock(() => {\n            if (!fs.existsSync(this.queuePath)) {\n                if (!this.restoreLastGoodQueue()) {\n                    this.writeJsonDirect([]);\n                }\n            }\n        });`;
const constructorNew = `        this.ensureRuntime();\n        if (!fs.existsSync(this.queuePath)) {\n            this.withLock(() => {\n                if (!fs.existsSync(this.queuePath)) {\n                    if (!this.restoreLastGoodQueue()) {\n                        this.writeJsonDirect([]);\n                    }\n                }\n            });\n        }`;
if (text.includes(constructorOld)) {
  text = text.replace(constructorOld, constructorNew);
  changes++;
} else if (!text.includes("if (!fs.existsSync(this.queuePath)) {\n            this.withLock(() => {")) {
  throw new Error("Could not locate exact constructor startup lock block.");
}

// 3) Replace exact local withLock implementation.
const withLockOld = `    withLock(fn) {\n        const locked = this.acquireLock();\n\n        if (!locked) {\n            const owner = this.readLockOwner();\n            const ageMs = this.lockAgeMs();\n            throw new Error(\n                "TaskQueue lock could not be acquired after timeout. " +\n                "lockPath=" + this.lockPath +\n                "; ageMs=" + String(ageMs) +\n                "; ownerPid=" + String(owner && owner.pid ? owner.pid : "unknown")\n            );\n        }\n\n        try {\n            return fn();\n        } finally {\n            this.releaseLock();\n        }\n    }`;

const withLockNew = `    withLock(fn) {\n        // Reentrant within the same TaskQueue singleton/process. Nested queue calls\n        // must not try to reacquire the filesystem lock already held by this instance.\n        if (this.lockDepth > 0) {\n            this.lockDepth++;\n            try {\n                return fn();\n            } finally {\n                this.lockDepth--;\n            }\n        }\n\n        const locked = this.acquireLock();\n\n        if (!locked) {\n            const owner = this.readLockOwner();\n            const ageMs = this.lockAgeMs();\n            throw new Error(\n                "TaskQueue lock could not be acquired after timeout. " +\n                "lockPath=" + this.lockPath +\n                "; ageMs=" + String(ageMs) +\n                "; ownerPid=" + String(owner && owner.pid ? owner.pid : "unknown")\n            );\n        }\n\n        this.lockDepth = 1;\n        try {\n            return fn();\n        } finally {\n            this.lockDepth = 0;\n            this.releaseLock();\n        }\n    }`;

if (text.includes(withLockOld)) {
  text = text.replace(withLockOld, withLockNew);
  changes++;
} else if (!text.includes("if (this.lockDepth > 0)")) {
  throw new Error("Could not locate exact local withLock() implementation.");
}

if (changes < 1) {
  console.log("TaskQueue reentrant V4 already appears installed; no changes needed.");
  process.exit(0);
}

const backupPath = backup();
fs.writeFileSync(file, text, "utf8");

console.log("=== TASKQUEUE REENTRANT LOCK P0 V4 ===");
console.log(`patched: ${file}`);
console.log(`backup : ${backupPath}`);
console.log(`changes: ${changes}`);
console.log("features: lockDepth + constructor startup guard + exact reentrant withLock()");
console.log("next   : node --check .\\CORE\\TaskQueue.js");
