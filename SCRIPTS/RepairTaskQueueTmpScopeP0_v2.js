"use strict";

const fs = require("fs");
const path = require("path");

const root = process.cwd();
const file = path.join(root, "CORE", "TaskQueue.js");
const src = fs.readFileSync(file, "utf8");

const start = src.indexOf("    writeJsonDirect(tasks) {");
if (start < 0) throw new Error("writeJsonDirect(tasks) not found");

const nextMethod = src.indexOf("\n    readJson()", start);
const end = nextMethod >= 0 ? nextMethod : src.indexOf("\n    add(", start);
if (end < 0) throw new Error("Could not determine end of writeJsonDirect()");

const block = src.slice(start, end);

const tmpRefs = (block.match(/\btmp\b/g) || []).length;
if (tmpRefs < 1) throw new Error("No tmp references found inside writeJsonDirect()");

const hasDeclaration = /\b(?:const|let|var)\s+tmp\b/.test(block);
if (hasDeclaration) {
  console.log("=== TASKQUEUE TMP SCOPE P0 V2 ===");
  console.log("tmp already declared inside writeJsonDirect(); no change made.");
  process.exit(0);
}

const anchor = block.indexOf("        try {");
if (anchor < 0) throw new Error("Could not locate first try block inside writeJsonDirect()");

const declaration = [
  "        const tmp = `${this.queuePath}.tmp_${process.pid}_${Date.now()}`;",
  ""
].join("\n");

const patchedBlock = block.slice(0, anchor) + declaration + block.slice(anchor);

const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
const backup = `${file}.BEFORE_TMP_SCOPE_FIX_${stamp}`;
fs.copyFileSync(file, backup);

const out = src.slice(0, start) + patchedBlock + src.slice(end);
fs.writeFileSync(file, out, "utf8");

console.log("=== TASKQUEUE TMP SCOPE P0 V2 ===");
console.log(`patched: ${file}`);
console.log(`backup : ${backup}`);
console.log("change : declared tmp inside writeJsonDirect() before first try block");
console.log("next   : node --check .\\CORE\\TaskQueue.js");
