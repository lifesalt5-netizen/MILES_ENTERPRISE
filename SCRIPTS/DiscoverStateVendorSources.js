"use strict";

const fs = require("fs");
const path = require("path");

const STATES = {
  AL: "ALABAMA", AK: "ALASKA", AZ: "ARIZONA", AR: "ARKANSAS", CA: "CALIFORNIA",
  CO: "COLORADO", CT: "CONNECTICUT", DE: "DELAWARE", FL: "FLORIDA", GA: "GEORGIA",
  HI: "HAWAII", ID: "IDAHO", IL: "ILLINOIS", IN: "INDIANA", IA: "IOWA",
  KS: "KANSAS", KY: "KENTUCKY", LA: "LOUISIANA", ME: "MAINE", MD: "MARYLAND",
  MA: "MASSACHUSETTS", MI: "MICHIGAN", MN: "MINNESOTA", MS: "MISSISSIPPI", MO: "MISSOURI",
  MT: "MONTANA", NE: "NEBRASKA", NV: "NEVADA", NH: "NEW HAMPSHIRE", NJ: "NEW JERSEY",
  NM: "NEW MEXICO", NY: "NEW YORK", NC: "NORTH CAROLINA", ND: "NORTH DAKOTA", OH: "OHIO",
  OK: "OKLAHOMA", OR: "OREGON", PA: "PENNSYLVANIA", RI: "RHODE ISLAND", SC: "SOUTH CAROLINA",
  SD: "SOUTH DAKOTA", TN: "TENNESSEE", TX: "TEXAS", UT: "UTAH", VT: "VERMONT",
  VA: "VIRGINIA", WA: "WASHINGTON", WV: "WEST VIRGINIA", WI: "WISCONSIN", WY: "WYOMING",
  DC: "DISTRICT OF COLUMBIA"
};

const EXTENSIONS = new Set([".csv", ".json", ".xlsx", ".xls", ".tsv", ".txt"]);
const SIGNALS = ["vendor", "vendors", "award", "awards", "contract", "contracts", "spend", "supplier", "procurement", "purchase", "payments"];
const STATE_CONTEXT = ["SLED", "STATE", "PROCUREMENT", "VENDOR", "VENDORS", "SUPPLIER", "SUPPLIERS", "PURCHASING"];
const FEDERAL_CONTEXT = ["GSA", "SAM", "USASPENDING", "FEDERAL", "VETERANS AFFAIRS"];
const SKIP_DIRS = new Set(["node_modules", ".git", "BACKUPS", "_BACKUPS", "_LEGACY_BUILDS"]);

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function normalize(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function detectState(filePath) {
  const normalized = normalize(filePath);
  const text = ` ${normalized} `;
  const tokens = new Set(normalized.split(" ").filter(Boolean));
  const hasStateContext = STATE_CONTEXT.some((token) => tokens.has(token));
  const hasFederalContext = FEDERAL_CONTEXT.some((token) => normalized.includes(token));
  const matches = [];

  for (const [abbr, full] of Object.entries(STATES)) {
    if (text.includes(` ${full} `)) {
      matches.push(abbr);
      continue;
    }

    if (!text.includes(` ${abbr} `)) continue;

    // Two-letter abbreviations are ambiguous (VA is often Veterans Affairs, CA can appear in IDs, etc.).
    // Accept abbreviations only when the path clearly lives in a state/SLED context and not a federal context.
    if (hasStateContext && !hasFederalContext) matches.push(abbr);
  }

  return [...new Set(matches)];
}

function detectSignals(filePath) {
  const text = filePath.toLowerCase();
  return SIGNALS.filter((signal) => text.includes(signal));
}

function walk(root, out) {
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(full, out);
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!EXTENSIONS.has(ext)) continue;

    const states = detectState(full);
    const signals = detectSignals(full);
    if (!states.length || !signals.length) continue;

    let stat = null;
    try { stat = fs.statSync(full); } catch {}
    out.push({
      path: full,
      extension: ext,
      states,
      signals,
      sizeBytes: stat?.size || 0,
      modifiedAt: stat?.mtime?.toISOString?.() || null
    });
  }
}

const root = path.resolve(arg("--root", process.env.P2GC_INTELLIGENCE_ROOT || process.cwd()));
const output = arg("--output", null);
const candidates = [];
walk(root, candidates);

candidates.sort((a, b) => {
  const stateCompare = (a.states[0] || "").localeCompare(b.states[0] || "");
  return stateCompare || a.path.localeCompare(b.path);
});

const statesFound = [...new Set(candidates.flatMap((row) => row.states))].sort();
const result = {
  ok: true,
  service: "STATE_VENDOR_SOURCE_DISCOVERY",
  mode: "READ_ONLY",
  root,
  generatedAt: new Date().toISOString(),
  candidateCount: candidates.length,
  statesFound,
  stateCount: statesFound.length,
  statesMissing: Object.keys(STATES).filter((state) => !statesFound.includes(state)),
  candidates,
  writesPerformed: Boolean(output),
  sourceFilesChanged: false
};

if (output) {
  const target = path.resolve(output);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(result, null, 2));
  result.output = target;
}

console.log(JSON.stringify(result, null, 2));
console.log(`STATE_VENDOR_SOURCE_DISCOVERY_STATUS=${candidates.length ? "CANDIDATES_FOUND" : "NO_CANDIDATES_FOUND"}`);
