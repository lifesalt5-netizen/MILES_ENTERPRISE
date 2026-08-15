"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT || process.cwd();
const file = path.join(ROOT, "SERVICES", "digital_coo", "DepartmentDashboardService.js");
if (!fs.existsSync(file)) throw new Error(`Missing ${file}`);
let text = fs.readFileSync(file, "utf8");
const original = text;
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
const backup = `${file}.BEFORE_8787_DEPARTMENT_TRUTH_${stamp}`;
fs.copyFileSync(file, backup);

if (!text.includes("path.join(this.runtimeDir, 'task_queue.json')")) {
  const anchor = "      path.join(this.runtimeDir, 'work_queue.json'),";
  if (!text.includes(anchor)) throw new Error("Could not locate work_queue source anchor.");
  text = text.replace(anchor, `${anchor}\n      path.join(this.runtimeDir, 'task_queue.json'),`);
}

if (!text.includes("collectWorkforceResults()")) {
  const anchor = "  runtimeEvidence() {";
  const idx = text.indexOf(anchor);
  if (idx < 0) throw new Error("Could not locate runtimeEvidence().");
  const method = `  collectWorkforceResults() {\n    const dir = path.join(this.rootDir, 'DATA', 'workforce_results');\n    if (!fs.existsSync(dir)) return [];\n    try {\n      return fs.readdirSync(dir)\n        .filter(name => name.endsWith('.json'))\n        .map(name => {\n          const file = path.join(dir, name);\n          return { file, mtimeMs: fs.statSync(file).mtimeMs };\n        })\n        .sort((a,b) => b.mtimeMs - a.mtimeMs)\n        .slice(0, 250)\n        .map(entry => {\n          const value = readJson(entry.file, null);\n          if (!value || typeof value !== 'object') return null;\n          return {\n            id: value.taskId || value.workPackageId || path.basename(entry.file, '.json'),\n            taskId: value.taskId || null,\n            title: value.objective || value.action || 'Workforce result',\n            action: value.action || value.capability || value.type || 'WORKFORCE_RESULT',\n            type: value.type || 'WORKFORCE_RESULT',\n            status: value.ok === false ? 'FAILED' : 'COMPLETED',\n            department: value.department || null,\n            provider: value.provider || null,\n            worker: value.assignedTo || null,\n            result: value.output || value.result || value,\n            evidence: entry.file,\n            completedAt: value.completedAt || value.createdAt || new Date(entry.mtimeMs).toISOString(),\n            updatedAt: value.completedAt || value.createdAt || new Date(entry.mtimeMs).toISOString(),\n            _source: entry.file,\n            _sourceModifiedAt: new Date(entry.mtimeMs).toISOString()\n          };\n        })\n        .filter(Boolean);\n    } catch {\n      return [];\n    }\n  }\n\n`;
  text = text.slice(0, idx) + method + text.slice(idx);
}

const oldCollect = "    const operations = this.collectOperations();";
const newCollect = "    const operations = [...this.collectOperations(), ...this.collectWorkforceResults()];";
if (text.includes(oldCollect)) text = text.replace(oldCollect, newCollect);
else if (!text.includes(newCollect)) throw new Error("Could not locate snapshot operation collection.");

// Department cards need scalar counts for the UI as well as arrays.
const oldFinalize = "      d.evidence = [...new Set(d.evidence)].slice(0, 10);";
const newFinalize = `      d.evidence = [...new Set(d.evidence)].slice(0, 10);\n      d.runningCount = d.current.length;\n      d.queueCount = d.queued.length;\n      d.completedCount = d.recentCompleted.length;\n      d.failedCount = d.blockers.length;\n      d.approvalCount = d.awaitingApproval.length;\n      d.currentWork = d.current;`;
if (text.includes(oldFinalize)) text = text.replace(oldFinalize, newFinalize);
else if (!text.includes("d.runningCount = d.current.length;")) throw new Error("Could not locate department finalize block.");

if (text === original) throw new Error("No changes applied.");
fs.writeFileSync(file, text, "utf8");
console.log("=== 8787 DEPARTMENT TRUTH P0 ===");
console.log("patched:", file);
console.log("backup :", backup);
console.log("change : task_queue + recent workforce results + consistent department counts/current work");
console.log("next   : node --check .\\SERVICES\\digital_coo\\DepartmentDashboardService.js");
