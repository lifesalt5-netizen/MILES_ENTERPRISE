"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const file = path.join(ROOT, "CORE", "TaskQueue.js");
let text = fs.readFileSync(file, "utf8");
const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
const backup = `${file}.BEFORE_REENTRANT_LOCK_V2_${stamp}`;
fs.copyFileSync(file, backup);

let changes = 0;

// 1) Add a per-instance reentrancy depth field.
const ctorNeedle = '        this.lockToken = null;\n\n        this.ensureRuntime();';
if (text.includes(ctorNeedle)) {
  text = text.replace(
    ctorNeedle,
    '        this.lockToken = null;\n        this.lockDepth = 0;\n\n        this.ensureRuntime();'
  );
  changes++;
}

// 2) Avoid taking the filesystem lock on every module load when the queue already exists.
const ctorLockBlock = `        this.ensureRuntime();\n        this.withLock(() => {\n            if (!fs.existsSync(this.queuePath)) {\n                if (!this.restoreLastGoodQueue()) {\n                    this.writeJsonDirect([]);\n                }\n            }\n        });`;
const ctorReplacement = `        this.ensureRuntime();\n        if (!fs.existsSync(this.queuePath)) {\n            this.withLock(() => {\n                if (!fs.existsSync(this.queuePath)) {\n                    if (!this.restoreLastGoodQueue()) {\n                        this.writeJsonDirect([]);\n                    }\n                }\n            });\n        }`;
if (text.includes(ctorLockBlock)) {
  text = text.replace(ctorLockBlock, ctorReplacement);
  changes++;
}

// 3) Replace the exact local withLock() implementation with a reentrant version.
const oldWithLock = `    withLock(fn) {\n        const locked = this.acquireLock();\n\n        if (!locked) {\n            const owner = this.readLockOwner();\n            const ageMs = this.lockAgeMs();\n            throw new Error(\n                "TaskQueue lock could not be acquired after timeout. " +\n                "lockPath=" + this.lockPath +\n                "; ageMs=" + String(ageMs) +\n                "; ownerPid=" + String(owner && owner.pid ? owner.pid : "unknown")\n            );\n        }\n\n        try {\n            return fn();\n        } finally {\n            this.releaseLock();\n        }\n    }`;

const newWithLock = `    withLock(fn) {\n        // Reentrant inside the same TaskQueue instance/process. Nested queue\n        // operations must not wait on a filesystem lock already owned by us.\n        if (Number(this.lockDepth || 0) > 0) {\n            this.lockDepth += 1;\n            try {\n                return fn();\n            } finally {\n                this.lockDepth -= 1;\n            }\n        }\n\n        const locked = this.acquireLock();\n\n        if (!locked) {\n            const owner = this.readLockOwner();\n            const ageMs = this.lockAgeMs();\n            throw new Error(\n                "TaskQueue lock could not be acquired after timeout. " +\n                "lockPath=" + this.lockPath +\n                "; ageMs=" + String(ageMs) +\n                "; ownerPid=" + String(owner && owner.pid ? owner.pid : "unknown")\n            );\n        }\n\n        this.lockDepth = 1;\n        try {\n            return fn();\n        } finally {\n            this.lockDepth = 0;\n            this.releaseLock();\n        }\n    }`;

if (text.includes(oldWithLock)) {
  text = text.replace(oldWithLock, newWithLock);
  changes++;
}

if (changes < 3) {
  throw new Error(`Expected 3 exact changes, applied ${changes}. Refusing partial patch.`);
}

fs.writeFileSync(file, text, "utf8");
console.log("=== TASKQUEUE REENTRANT LOCK P0 V2 ===");
console.log("patched:", file);
console.log("backup :", backup);
console.log("changes:", changes);
console.log("next   : node --check .\\CORE\\TaskQueue.js");
