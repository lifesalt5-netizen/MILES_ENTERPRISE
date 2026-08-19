"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT || path.resolve(__dirname, "..");
const TARGET_DIR = path.join(ROOT, "DATA", "revenue");
const TARGETS = [
  "revenue_work_queue.json",
  "crm_followups.json",
  "proposal_deadlines.json",
  "client_deliverables.json",
  "orion_recommendations.json"
];
const KEYWORDS = /(revenue|pipeline|deal|lead|prospect|follow.?up|proposal|deadline|client|deliverable|orion|recommend|reply|campaign|instantly|meeting|crm)/i;
const SKIP_DIRS = new Set(["node_modules", ".git", "queue_backups", "BACKUP_20260814"]);

function safeStat(file) {
  try { return fs.statSync(file); } catch { return null; }
}

function sanitize(raw) {
  return String(raw || "").replace(/^\uFEFF/, "").trim();
}

function extractItems(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  const arrays = [
    value.operations, value.items, value.workItems, value.missions,
    value.followups, value.deadlines, value.deliverables, value.recommendations,
    value.leads, value.deals, value.clients, value.opportunities, value.records,
    value.results, value.tasks
  ];
  return arrays.find(Array.isArray) || [];
}

function inspectJson(file) {
  const stat = safeStat(file);
  if (!stat) return { exists: false, bytes: 0, count: 0, shape: "MISSING" };
  try {
    const raw = sanitize(fs.readFileSync(file, "utf8"));
    if (!raw) return { exists: true, bytes: stat.size, count: 0, shape: "EMPTY_FILE" };
    const parsed = JSON.parse(raw);
    const items = extractItems(parsed);
    return {
      exists: true,
      bytes: stat.size,
      count: items.length,
      shape: Array.isArray(parsed) ? "ARRAY" : `OBJECT keys=${Object.keys(parsed).slice(0, 12).join(",")}`,
      sampleKeys: items[0] && typeof items[0] === "object" ? Object.keys(items[0]).slice(0, 16) : []
    };
  } catch (error) {
    return { exists: true, bytes: stat.size, count: 0, shape: "PARSE_ERROR", error: error.message };
  }
}

function walk(dir, results, depth = 0) {
  if (depth > 7) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, results, depth + 1);
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (![".json", ".jsonl", ".csv"].includes(ext)) continue;
    if (!KEYWORDS.test(entry.name) && !KEYWORDS.test(full)) continue;
    const stat = safeStat(full);
    if (!stat) continue;
    results.push({
      file: full,
      ext,
      bytes: stat.size,
      modified: stat.mtime.toISOString()
    });
  }
}

console.log("=== REVENUE MISSION SOURCE COVERAGE P0 ===");
console.log(`root: ${ROOT}`);
console.log(`targetDir: ${TARGET_DIR}`);
console.log("\n=== CONFIGURED REVENUE SOURCES ===");
for (const name of TARGETS) {
  const file = path.join(TARGET_DIR, name);
  const info = inspectJson(file);
  console.log(`${name.padEnd(32)} exists=${String(info.exists).padEnd(5)} bytes=${String(info.bytes).padEnd(10)} items=${String(info.count).padEnd(6)} shape=${info.shape}`);
  if (info.sampleKeys && info.sampleKeys.length) console.log(`  sampleKeys: ${info.sampleKeys.join(", ")}`);
  if (info.error) console.log(`  error: ${info.error}`);
}

console.log("\n=== CANDIDATE EXISTING DATA FILES UNDER MILES DATA ===");
const candidates = [];
walk(path.join(ROOT, "DATA"), candidates);
candidates.sort((a, b) => b.modified.localeCompare(a.modified));
for (const item of candidates.slice(0, 120)) {
  let extra = "";
  if (item.ext === ".json" && item.bytes <= 25 * 1024 * 1024) {
    const info = inspectJson(item.file);
    extra = ` items=${info.count} shape=${info.shape}`;
  }
  console.log(`${item.modified}  ${(item.bytes / 1024).toFixed(1).padStart(10)} KB  ${item.file}${extra}`);
}

console.log("\n=== SUMMARY ===");
console.log(`configuredSources=${TARGETS.length}`);
console.log(`candidateFiles=${candidates.length}`);
console.log("READ_ONLY=true");
console.log("No source files were modified.");
