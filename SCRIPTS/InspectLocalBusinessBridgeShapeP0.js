"use strict";

const fs = require("fs");
const path = require("path");

const root = process.env.MILES_ROOT || process.cwd();
const file = path.join(root, "SERVICES", "BusinessOperationsBridgeService.js");
const text = fs.readFileSync(file, "utf8");
const lines = text.split(/\r?\n/);

function printAround(label, needle, before = 20, after = 80) {
  const idx = lines.findIndex(line => line.includes(needle));
  console.log(`\n=== ${label} ===`);
  if (idx < 0) {
    console.log(`NOT FOUND: ${needle}`);
    return;
  }
  const start = Math.max(0, idx - before);
  const end = Math.min(lines.length, idx + after + 1);
  for (let i = start; i < end; i++) {
    console.log(String(i + 1).padStart(5, " ") + ": " + lines[i]);
  }
}

console.log("=== LOCAL BUSINESS BRIDGE SHAPE P0 ===");
console.log("file=" + file);
console.log("bytes=" + Buffer.byteLength(text, "utf8"));

printAround("TaskQueue require", 'require("../CORE/TaskQueue")', 15, 30);
printAround("constructor", "constructor(options = {})", 10, 50);
printAround("enqueueTask", "enqueueTask(operation", 20, 100);
printAround("bridgeOperation", "bridgeOperation(operationId", 20, 100);
