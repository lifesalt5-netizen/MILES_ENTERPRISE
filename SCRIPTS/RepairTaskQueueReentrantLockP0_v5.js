const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const file = path.join(ROOT, 'CORE', 'TaskQueue.js');
const original = fs.readFileSync(file, 'utf8');
let text = original;
let changes = 0;

function replaceOnceByRegex(label, regex, replacement) {
  const before = text;
  text = text.replace(regex, replacement);
  if (text !== before) {
    changes++;
    console.log(`[PATCH] ${label}`);
    return true;
  }
  console.log(`[MISS] ${label}`);
  return false;
}

// 1) Add reentrant depth state immediately after lockToken initialization.
replaceOnceByRegex(
  'lockDepth state',
  /(this\.lockToken\s*=\s*null;\s*)/,
  `$1\n        this.lockDepth = 0;\n`
);

// 2) Guard constructor initialization so an existing canonical queue does not require a lock on every require().
replaceOnceByRegex(
  'constructor startup guard',
  /this\.ensureRuntime\(\);\s*this\.withLock\(\(\)\s*=>\s*\{\s*if\s*\(!fs\.existsSync\(this\.queuePath\)\)\s*\{\s*if\s*\(!this\.restoreLastGoodQueue\(\)\)\s*\{\s*this\.writeJsonDirect\(\[\]\);\s*\}\s*\}\s*\}\);/,
  `this.ensureRuntime();\n        if (!fs.existsSync(this.queuePath)) {\n            this.withLock(() => {\n                if (!fs.existsSync(this.queuePath)) {\n                    if (!this.restoreLastGoodQueue()) {\n                        this.writeJsonDirect([]);\n                    }\n                }\n            });\n        }`
);

// 3) Replace withLock by locating method boundaries structurally, independent of whitespace/comments.
const start = text.indexOf('    withLock(fn) {');
if (start >= 0) {
  const after = text.indexOf('\n    sanitizeJsonText(', start);
  if (after > start) {
    const replacement = `    withLock(fn) {\n        if (this.lockDepth > 0) {\n            this.lockDepth += 1;\n            try {\n                return fn();\n            } finally {\n                this.lockDepth = Math.max(0, this.lockDepth - 1);\n            }\n        }\n\n        const locked = this.acquireLock();\n\n        if (!locked) {\n            const owner = this.readLockOwner();\n            const ageMs = this.lockAgeMs();\n            throw new Error(\n                \"TaskQueue lock could not be acquired after timeout. \" +\n                \"lockPath=\" + this.lockPath +\n                \"; ageMs=\" + String(ageMs) +\n                \"; ownerPid=\" + String(owner && owner.pid ? owner.pid : \"unknown\")\n            );\n        }\n\n        this.lockDepth = 1;\n        try {\n            return fn();\n        } finally {\n            this.lockDepth = 0;\n            this.releaseLock();\n        }\n    }\n`;
    text = text.slice(0, start) + replacement + text.slice(after);
    changes++;
    console.log('[PATCH] reentrant withLock');
  } else {
    console.log('[MISS] withLock end boundary');
  }
} else {
  console.log('[MISS] withLock start boundary');
}

if (changes !== 3) {
  fs.writeFileSync(file, original, 'utf8');
  throw new Error(`Expected 3 changes, applied ${changes}. Original restored.`);
}

const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
const backup = `${file}.BEFORE_REENTRANT_LOCK_V5_${stamp}`;
fs.writeFileSync(backup, original, 'utf8');
fs.writeFileSync(file, text, 'utf8');

console.log('=== TASKQUEUE REENTRANT LOCK P0 V5 ===');
console.log(`patched: ${file}`);
console.log(`backup : ${backup}`);
console.log('changes: lockDepth + constructor startup guard + structural reentrant withLock');
console.log('next   : node --check .\\CORE\\TaskQueue.js');
