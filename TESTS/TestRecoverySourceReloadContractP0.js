"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = process.env.MILES_ROOT || process.cwd();
const repairPath = path.join(ROOT, "SCRIPTS", "RepairTaskQueueAndCompleteAcceptance.ps1");
const source = fs.readFileSync(repairPath, "utf8");

const requiredSurfaces = [
  "miles-api",
  "miles-executive-dashboard",
  "miles-desktop-ui",
  "p2gc-customer-delivery",
  "p2gc-growth-demo"
];

const checks = [];
function check(name, ok, detail = "") {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${detail ? ` :: ${detail}` : ""}`);
}

check(
  "repair declares source-updated surface reload",
  /function\s+Restart-SourceUpdatedSurfaces\b/.test(source),
  repairPath
);

const start = source.indexOf("function Restart-SourceUpdatedSurfaces");
const end = start >= 0 ? source.indexOf("\nfunction ", start + 10) : -1;
const block = start >= 0 ? source.slice(start, end >= 0 ? end : source.length) : "";

for (const name of requiredSurfaces) {
  check(`source reload includes ${name}`, block.includes(name));
}

const declarationIndex = source.indexOf("Restart-SourceUpdatedSurfaces");
const invocationIndex = declarationIndex >= 0 ? source.indexOf("Restart-SourceUpdatedSurfaces", declarationIndex + 1) : -1;
const r3Index = source.indexOf("=== R3: POST-REPAIR SURFACE PROBE ===");
check(
  "source-updated surfaces reload before live HTTP probe",
  declarationIndex >= 0 && invocationIndex >= 0 && r3Index >= 0 && invocationIndex < r3Index,
  `reloadCall=${invocationIndex} r3=${r3Index}`
);

const failed = checks.filter(x => !x.ok);
if (failed.length) {
  console.error("=== RECOVERY SOURCE RELOAD CONTRACT P0 FAIL ===");
  process.exit(1);
}

console.log("=== RECOVERY SOURCE RELOAD CONTRACT P0 PASS ===");
