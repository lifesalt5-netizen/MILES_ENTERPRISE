"use strict";

const fs = require("fs");
const path = require("path");

const root = process.env.MILES_ROOT || path.resolve(__dirname, "..");
const file = path.join(root, "CORE", "TaskQueue.js");
const src = fs.readFileSync(file, "utf8");
const lines = src.split(/\r?\n/);

function printSection(title, pattern, before = 8, after = 80) {
  const idx = lines.findIndex(line => line.includes(pattern));
  console.log(`\n=== ${title} ===`);
  if (idx < 0) {
    console.log(`NOT FOUND: ${pattern}`);
    return;
  }
  const start = Math.max(0, idx - before);
  const end = Math.min(lines.length - 1, idx + after);
  for (let i = start; i <= end; i++) {
    console.log(String(i + 1).padStart(5) + ": " + lines[i]);
  }
}

console.log("=== TASKQUEUE LOCK INTERACTIONS P0 ===");
console.log(`file=${file}`);
console.log(`bytes=${Buffer.byteLength(src, "utf8")}`);

printSection("constructor", "constructor()", 4, 40);
printSection("acquireLock", "acquireLock()", 6, 90);
printSection("releaseLock", "releaseLock()", 6, 55);
printSection("withLock", "withLock(fn)", 6, 70);
printSection("_read", "_read()", 4, 65);
printSection("_write", "_write(tasks)", 4, 35);
printSection("list", "list()", 6, 55);
printSection("claimNextExecutableTask", "claimNextExecutableTask(options", 6, 150);

console.log("\n=== withLock() CALL SITES ===");
lines.forEach((line, i) => {
  if (line.includes("withLock(")) console.log(String(i + 1).padStart(5) + ": " + line.trim());
});

console.log("\n=== new TaskQueue() CALLS IN FILE ===");
lines.forEach((line, i) => {
  if (line.includes("new TaskQueue")) console.log(String(i + 1).padStart(5) + ": " + line.trim());
});
