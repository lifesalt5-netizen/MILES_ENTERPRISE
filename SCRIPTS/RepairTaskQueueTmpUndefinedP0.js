"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT || process.cwd();
const file = path.join(ROOT, "CORE", "TaskQueue.js");

if (!fs.existsSync(file)) {
  throw new Error(`TaskQueue.js not found: ${file}`);
}

let text = fs.readFileSync(file, "utf8");
const original = text;
const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
const backup = `${file}.BEFORE_TMP_UNDEFINED_FIX_${stamp}`;
fs.copyFileSync(file, backup);

let changes = 0;

// Repair a malformed Windows fallback that references `tmp` outside writeJsonDirect scope.
// This patch is intentionally structural: it only touches the writeJsonDirect() body.
const start = text.indexOf("    writeJsonDirect(tasks) {");
const end = text.indexOf("\n    _read() {", start);

if (start === -1 || end === -1) {
  throw new Error("Could not locate writeJsonDirect() boundaries; refusing to modify file.");
}

let block = text.slice(start, end);

// Ensure tmp is declared once, before any fallback branch can reference it.
if (!/const\s+tmp\s*=/.test(block)) {
  const anchor = /const\s+json\s*=\s*JSON\.stringify\([\s\S]*?\);/;
  const m = block.match(anchor);
  if (!m) {
    throw new Error("Could not locate JSON serialization block inside writeJsonDirect().");
  }

  const insertion = `${m[0]}\n\n        const tmp =\n            \`${this.queuePath}.tmp_\` +\n            \`${process.pid}_\` +\n            \`${Date.now()}\`;`;
  block = block.replace(m[0], insertion);
  changes++;
}

// Remove any duplicate or later tmp declaration(s), keeping the first.
let seenTmp = false;
block = block.replace(/\n\s*const\s+tmp\s*=\s*\n?\s*`\$\{this\.queuePath\}\.tmp_`\s*\+\s*\n?\s*`\$\{process\.pid\}_`\s*\+\s*\n?\s*`\$\{Date\.now\(\)\}`\s*;/g, (match) => {
  if (!seenTmp) {
    seenTmp = true;
    return match;
  }
  changes++;
  return "";
});

// If a broken fallback helper or closure mentions tmp before declaration, fail closed rather than guessing.
const firstTmp = block.search(/const\s+tmp\s*=/);
const firstTmpUse = block.search(/\btmp\b/);
if (firstTmpUse !== -1 && firstTmp !== -1 && firstTmpUse < firstTmp) {
  throw new Error("Found a tmp reference before declaration in local writeJsonDirect(); refusing unsafe rewrite.");
}

if (changes === 0) {
  throw new Error("No safe tmp-scope repair was needed or local shape differs; refusing to modify file.");
}

text = text.slice(0, start) + block + text.slice(end);
fs.writeFileSync(file, text, "utf8");

console.log("=== TASKQUEUE TMP UNDEFINED REPAIR P0 ===");
console.log(`patched: ${file}`);
console.log(`backup : ${backup}`);
console.log(`changes: ${changes}`);
console.log("next   : node --check .\\CORE\\TaskQueue.js");
