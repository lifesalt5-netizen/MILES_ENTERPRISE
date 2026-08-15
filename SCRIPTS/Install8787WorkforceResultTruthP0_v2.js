"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT || process.cwd();
const file = path.join(ROOT, "SERVICES", "ExecutiveResponseService.js");
if (!fs.existsSync(file)) throw new Error(`Missing ${file}`);

let text = fs.readFileSync(file, "utf8");
const original = text;
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
const backup = `${file}.BEFORE_8787_WORKFORCE_RESULT_TRUTH_V2_${stamp}`;
fs.copyFileSync(file, backup);

if (!text.includes("readWorkforceResult(taskId)")) {
  const anchor = "  summarizeTask(task) {";
  const idx = text.indexOf(anchor);
  if (idx < 0) throw new Error("Could not locate summarizeTask(task).");

  const method = [
    "  readWorkforceResult(taskId) {",
    "    if (!taskId) return null;",
    "    const dir = path.join(this.rootDir, \"DATA\", \"workforce_results\");",
    "    if (!fs.existsSync(dir)) return null;",
    "",
    "    const exact = path.join(dir, \"WP_\" + taskId + \".json\");",
    "    const exactResult = this.readJson(exact, null);",
    "    if (exactResult) return exactResult;",
    "",
    "    try {",
    "      const matches = fs.readdirSync(dir)",
    "        .filter(name => name.endsWith(\".json\") && name.includes(String(taskId)))",
    "        .map(name => {",
    "          const candidate = path.join(dir, name);",
    "          return { file: candidate, mtimeMs: fs.statSync(candidate).mtimeMs };",
    "        })",
    "        .sort((a, b) => b.mtimeMs - a.mtimeMs);",
    "",
    "      for (const match of matches) {",
    "        const value = this.readJson(match.file, null);",
    "        if (value && String(value.taskId || \"\") === String(taskId)) return value;",
    "      }",
    "    } catch {}",
    "",
    "    return null;",
    "  }",
    ""
  ].join("\n");

  text = text.slice(0, idx) + method + text.slice(idx);
}

const summarizeStart = text.indexOf("  summarizeTask(task) {");
const summarizeEnd = text.indexOf("\n  buildExecutiveMessage(", summarizeStart);
if (summarizeStart < 0 || summarizeEnd < 0) {
  throw new Error("Could not locate summarizeTask boundaries.");
}

let summarize = text.slice(summarizeStart, summarizeEnd);

if (!summarize.includes("const workforceResult = this.readWorkforceResult(task.id);")) {
  const payloadAnchor = "    const payload = task.payload || {};";
  if (!summarize.includes(payloadAnchor)) throw new Error("Could not locate payload anchor in summarizeTask.");
  summarize = summarize.replace(
    payloadAnchor,
    payloadAnchor + "\n    const workforceResult = this.readWorkforceResult(task.id);"
  );
}

summarize = summarize.replace(
  /    const result =\s*\n\s*task\.result \|\|\s*\n\s*payload\.result \|\|\s*\n\s*null;/m,
  "    const result =\n      task.result ||\n      payload.result ||\n      workforceResult ||\n      null;"
);

summarize = summarize.replace(
  /      status: task\.status,/,
  "      status: workforceResult\n        ? (workforceResult.ok === false ? \"FAILED\" : \"COMPLETED\")\n        : task.status,"
);

text = text.slice(0, summarizeStart) + summarize + text.slice(summarizeEnd);

if (!text.includes("const workforceResult = this.readWorkforceResult(task.id);")) {
  throw new Error("Workforce result lookup was not installed.");
}
if (!text.includes("workforceResult ||")) {
  throw new Error("Persisted workforce result was not wired into summarizeTask.");
}

if (text === original) {
  console.log("=== 8787 WORKFORCE RESULT TRUTH P0 V2 ===");
  console.log("status : ALREADY_INSTALLED");
  console.log("target :", file);
  process.exit(0);
}

fs.writeFileSync(file, text, "utf8");
console.log("=== 8787 WORKFORCE RESULT TRUTH P0 V2 ===");
console.log("patched:", file);
console.log("backup :", backup);
console.log("change : structural summarizeTask patch; persisted workforce result becomes execution truth");
console.log("next   : node --check .\\SERVICES\\ExecutiveResponseService.js");
