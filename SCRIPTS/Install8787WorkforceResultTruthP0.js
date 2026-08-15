"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT || process.cwd();
const file = path.join(ROOT, "SERVICES", "ExecutiveResponseService.js");
if (!fs.existsSync(file)) throw new Error(`Missing ${file}`);
let text = fs.readFileSync(file, "utf8");
const original = text;
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
const backup = `${file}.BEFORE_8787_WORKFORCE_RESULT_TRUTH_${stamp}`;
fs.copyFileSync(file, backup);

if (!text.includes("readWorkforceResult(taskId)")) {
  const anchor = "  summarizeTask(task) {";
  const idx = text.indexOf(anchor);
  if (idx < 0) throw new Error("Could not locate summarizeTask(task).");
  const patch = `  readWorkforceResult(taskId) {\n    if (!taskId) return null;\n    const dir = path.join(this.rootDir, \"DATA\", \"workforce_results\");\n    if (!fs.existsSync(dir)) return null;\n\n    const exact = path.join(dir, \"WP_\" + taskId + \".json\");\n    const exactResult = this.readJson(exact, null);\n    if (exactResult) return exactResult;\n\n    // Older work packages can prefix the task id with a work-package id.\n    // Search only filenames, newest first, and read the first exact task-id match.\n    try {\n      const matches = fs.readdirSync(dir)\n        .filter(name => name.endsWith(\".json\") && name.includes(String(taskId)))\n        .map(name => ({\n          file: path.join(dir, name),\n          mtimeMs: fs.statSync(path.join(dir, name)).mtimeMs\n        }))\n        .sort((a, b) => b.mtimeMs - a.mtimeMs);\n      for (const match of matches) {\n        const value = this.readJson(match.file, null);\n        if (value && String(value.taskId || \"\") === String(taskId)) return value;\n      }\n    } catch {}\n    return null;\n  }\n\n`;
  text = text.slice(0, idx) + patch + text.slice(idx);
}

const oldResult = `    const result =\n      task.result ||\n      payload.result ||\n      null;`;
const newResult = `    const workforceResult = this.readWorkforceResult(task.id);\n    const result =\n      task.result ||\n      payload.result ||\n      workforceResult ||\n      null;`;
if (text.includes(oldResult)) {
  text = text.replace(oldResult, newResult);
} else if (!text.includes("const workforceResult = this.readWorkforceResult(task.id);")) {
  throw new Error("Could not locate summarizeTask result block.");
}

// A persisted workforce result is stronger execution truth than a stale queue status.
const oldStatus = `      status: task.status,`;
const newStatus = `      status: workforceResult\n        ? (workforceResult.ok === false ? \"FAILED\" : \"COMPLETED\")\n        : task.status,`;
if (text.includes(oldStatus)) text = text.replace(oldStatus, newStatus);

if (text === original) throw new Error("No changes applied.");
fs.writeFileSync(file, text, "utf8");
console.log("=== 8787 WORKFORCE RESULT TRUTH P0 ===");
console.log("patched:", file);
console.log("backup :", backup);
console.log("change : operation polling now resolves persisted workforce result files and treats them as execution truth");
console.log("next   : node --check .\\SERVICES\\ExecutiveResponseService.js");
