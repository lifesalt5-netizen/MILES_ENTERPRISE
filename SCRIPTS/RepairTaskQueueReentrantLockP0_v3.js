"use strict";

const fs = require("fs");
const path = require("path");

const root = process.cwd();
const file = path.join(root, "CORE", "TaskQueue.js");
const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
const backup = `${file}.BEFORE_REENTRANT_LOCK_V3_${stamp}`;

let src = fs.readFileSync(file, "utf8");
fs.copyFileSync(file, backup);

let changes = 0;

if (!src.includes("this.lockDepth = 0;")) {
  src = src.replace(
    "        this.lockToken = null;",
    "        this.lockToken = null;\n        this.lockDepth = 0;"
  );
  changes++;
}

const oldCtor = `        this.ensureRuntime();\n        this.withLock(() => {\n            if (!fs.existsSync(this.queuePath)) {\n                if (!this.restoreLastGoodQueue()) {\n                    this.writeJsonDirect([]);\n                }\n            }\n        });`;
const newCtor = `        this.ensureRuntime();\n        if (!fs.existsSync(this.queuePath)) {\n            this.withLock(() => {\n                if (!fs.existsSync(this.queuePath)) {\n                    if (!this.restoreLastGoodQueue()) {\n                        this.writeJsonDirect([]);\n                    }\n                }\n            });\n        }`;
if (src.includes(oldCtor)) {
  src = src.replace(oldCtor, newCtor);
  changes++;
}

const oldWithLock = `    withLock(fn) {\n        const locked = this.acquireLock();\n\n        if (!locked) {\n            const owner = this.readLockOwner();\n            const ageMs = this.lockAgeMs();\n            throw new Error(\n                "TaskQueue lock could not be acquired after timeout. " +\n                "lockPath=" + this.lockPath +\n                "; ageMs=" + String(ageMs) +\n                "; ownerPid=" + String(owner && owner.pid ? owner.pid : "unknown")\n            );\n        }\n\n        try {\n            return fn();\n        } finally {\n            this.releaseLock();\n        }\n    }`;
const newWithLock = `    withLock(fn) {\n        if (this.lockDepth > 0) {\n            this.lockDepth++;\n            try {\n                return fn();\n            } finally {\n                this.lockDepth--;\n            }\n        }\n\n        const owner = this.readLockOwner();\n        if (\n            owner &&\n            owner.pid === process.pid &&\n            owner.token &&\n            owner.token === this.lockToken\n        ) {\n            this.lockDepth = 1;\n            try {\n                return fn();\n            } finally {\n                this.lockDepth = 0;\n            }\n        }\n\n        const locked = this.acquireLock();\n\n        if (!locked) {\n            const currentOwner = this.readLockOwner();\n            const ageMs = this.lockAgeMs();\n            throw new Error(\n                "TaskQueue lock could not be acquired after timeout. " +\n                "lockPath=" + this.lockPath +\n                "; ageMs=" + String(ageMs) +\n                "; ownerPid=" + String(currentOwner && currentOwner.pid ? currentOwner.pid : "unknown")\n            );\n        }\n\n        this.lockDepth = 1;\n        try {\n            return fn();\n        } finally {\n            this.lockDepth = 0;\n            this.releaseLock();\n        }\n    }`;
if (src.includes(oldWithLock)) {
  src = src.replace(oldWithLock, newWithLock);
  changes++;
}

if (changes !== 3) {
  fs.copyFileSync(backup, file);
  throw new Error(`Expected 3 exact changes, applied ${changes}. Original restored.`);
}

fs.writeFileSync(file, src, "utf8");
console.log("=== TASKQUEUE REENTRANT LOCK P0 V3 ===");
console.log(`patched: ${file}`);
console.log(`backup : ${backup}`);
console.log("changes: lockDepth state + constructor startup guard + exact reentrant withLock()");
console.log("next   : node --check .\\CORE\\TaskQueue.js");
