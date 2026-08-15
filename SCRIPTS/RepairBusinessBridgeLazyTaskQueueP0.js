"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const target = path.join(ROOT, "SERVICES", "BusinessOperationsBridgeService.js");

if (!fs.existsSync(target)) {
  throw new Error("Missing target: " + target);
}

let text = fs.readFileSync(target, "utf8");
const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
const backup = target + ".BEFORE_LAZY_TASKQUEUE_" + stamp;
fs.copyFileSync(target, backup);

let changes = 0;

const oldCatch = `try {\n  taskQueue = require("../CORE/TaskQueue");\n} catch {\n  taskQueue = null;\n}`;
const newCatch = `try {\n  taskQueue = require("../CORE/TaskQueue");\n} catch (error) {\n  console.error("[BUSINESS-BRIDGE] Initial TaskQueue load failed:", error.message);\n  taskQueue = null;\n}`;
if (text.includes(oldCatch)) {
  text = text.replace(oldCatch, newCatch);
  changes++;
}

const marker = `  enqueueTask(operation) {\n    if (!this.taskQueue) {\n      throw new Error("TaskQueue unavailable");\n    }`;
const replacement = `  recoverTaskQueue() {\n    if (this.taskQueue && typeof this.taskQueue.add === "function") {\n      return this.taskQueue;\n    }\n\n    try {\n      const modulePath = require.resolve("../CORE/TaskQueue");\n      delete require.cache[modulePath];\n      this.taskQueue = require("../CORE/TaskQueue");\n      this.log("TaskQueue recovered lazily after startup load failure.");\n      return this.taskQueue;\n    } catch (error) {\n      this.log("TaskQueue lazy recovery failed: " + error.message);\n      this.taskQueue = null;\n      return null;\n    }\n  }\n\n  enqueueTask(operation) {\n    const queue = this.recoverTaskQueue();\n\n    if (!queue) {\n      throw new Error("TaskQueue unavailable after lazy recovery");\n    }`;

if (!text.includes(marker)) {
  throw new Error("Expected enqueueTask() block not found. Local bridge differs from inspected source.");
}
text = text.replace(marker, replacement);
changes++;

text = text.replace(
  `    if (typeof this.taskQueue.add !== "function") {\n      throw new Error("TaskQueue.add(type, payload, priority) unavailable");\n    }\n\n    return this.taskQueue.add(task.type, task.payload, task.priority);`,
  `    if (typeof queue.add !== "function") {\n      throw new Error("TaskQueue.add(type, payload, priority) unavailable");\n    }\n\n    return queue.add(task.type, task.payload, task.priority);`
);
changes++;

fs.writeFileSync(target, text, "utf8");

console.log("=== BUSINESS BRIDGE LAZY TASKQUEUE P0 ===");
console.log("patched:", target);
console.log("backup :", backup);
console.log("changes:", changes);
console.log("next   : node --check .\\SERVICES\\BusinessOperationsBridgeService.js");
