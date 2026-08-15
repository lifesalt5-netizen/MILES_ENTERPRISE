"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT || path.resolve(__dirname, "..");
const file = path.join(ROOT, "CORE", "TaskQueue.js");
const text = fs.readFileSync(file, "utf8");
const lines = text.split(/\r?\n/);

function printRange(start, end, label) {
  console.log(`\n=== ${label} ===`);
  for (let i = Math.max(1, start); i <= Math.min(lines.length, end); i++) {
    console.log(String(i).padStart(5) + ": " + lines[i - 1]);
  }
}

console.log("=== LOCAL TASKQUEUE writeJsonDirect SHAPE P0 ===");
console.log("file=" + file);
console.log("bytes=" + Buffer.byteLength(text, "utf8"));

const idx = lines.findIndex(line => line.includes("writeJsonDirect("));
if (idx < 0) throw new Error("writeJsonDirect() not found");

printRange(idx - 20 + 1, idx + 120 + 1, "writeJsonDirect vicinity");

const tmpRefs = [];
lines.forEach((line, i) => {
  if (/\btmp\b/.test(line)) tmpRefs.push(i + 1);
});
console.log("\n=== tmp references ===");
console.log(tmpRefs.join(", "));

tmpRefs.slice(0, 20).forEach((n, j) => printRange(n - 3, n + 3, `tmp ref ${j + 1}`));

console.log("\n=== END ===");
