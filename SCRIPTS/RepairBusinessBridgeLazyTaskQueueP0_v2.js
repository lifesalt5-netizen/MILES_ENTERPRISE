"use strict";

const fs = require("fs");
const path = require("path");

const root = process.cwd();
const file = path.join(root, "SERVICES", "BusinessOperationsBridgeService.js");

if (!fs.existsSync(file)) {
  throw new Error("Missing BusinessOperationsBridgeService.js: " + file);
}

const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
const backup = file + ".BEFORE_LAZY_TASKQUEUE_V2_" + stamp;
fs.copyFileSync(file, backup);

let text = fs.readFileSync(file, "utf8");
let changes = 0;

const oldRequire = `try {\n  taskQueue = require("../CORE/TaskQueue");\n} catch {\n  taskQueue = null;\n}`;
const newRequire = `try {\n  taskQueue = require("../CORE/TaskQueue");\n} catch (error) {\n  console.error("[BUSINESS-BRIDGE] Initial TaskQueue load failed:", error.message);\n  taskQueue = null;\n}`;

if (text.includes(oldRequire)) {
  text = text.replace(oldRequire, newRequire);
  changes++;
}

const oldEnqueue = `  enqueueTask(operation) {\n    if (!this.taskQueue) throw new Error("TaskQueue unavailable");\n    const task = this.buildTaskParts(operation);`;

const newEnqueue = `  enqueueTask(operation) {\n    if (!this.taskQueue) {\n      try {\n        const modulePath = require.resolve("../CORE/TaskQueue");\n        delete require.cache[modulePath];\n        this.taskQueue = require("../CORE/TaskQueue");\n        taskQueue = this.taskQueue;\n        this.log("TaskQueue lazy reload succeeded.");\n      } catch (error) {\n        console.error("[BUSINESS-BRIDGE] TaskQueue lazy reload failed:", error.message);\n        throw new Error("TaskQueue unavailable: " + error.message);\n      }\n    }\n    const task = this.buildTaskParts(operation);`;

if (text.includes(oldEnqueue)) {
  text = text.replace(oldEnqueue, newEnqueue);
  changes++;
}

if (changes === 0) {
  throw new Error("No matching local bridge blocks found; refusing to modify file.");
}

fs.writeFileSync(file, text, "utf8");

console.log("=== BUSINESS BRIDGE LAZY TASKQUEUE REPAIR P0 V2 ===");
console.log("patched:", file);
console.log("backup :", backup);
console.log("changes:", changes);
console.log("next   : node --check .\\SERVICES\\BusinessOperationsBridgeService.js");