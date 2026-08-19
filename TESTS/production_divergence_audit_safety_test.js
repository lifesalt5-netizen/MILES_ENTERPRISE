"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const scriptPath = path.join(root, "SCRIPTS", "AUDIT_MILES_PRODUCTION_DIVERGENCE.ps1");
const text = fs.readFileSync(scriptPath, "utf8");

assert(/git fetch origin main/i.test(text), "audit should refresh origin/main metadata");
assert(/rev-list --left-right --count HEAD\.\.\.origin\/main/i.test(text), "audit should measure ahead/behind counts");
assert(/origin\/main\.\.HEAD/i.test(text), "audit should list local-only commits");
assert(/HEAD\.\.origin\/main/i.test(text), "audit should list remote-only commits");
assert(/status --porcelain/i.test(text), "audit should capture working-tree changes");
assert(/Get-CimInstance Win32_Process/i.test(text), "audit should inspect running Node processes");
assert(/MILES_PRODUCTION_RECONCILIATION_/i.test(text), "audit should write reports outside the repository");

const forbidden = [
  /\bgit\s+merge\b/i,
  /\bgit\s+rebase\b/i,
  /\bgit\s+reset\b/i,
  /\bgit\s+checkout\b/i,
  /\bgit\s+switch\b/i,
  /\bgit\s+stash\b/i,
  /\bgit\s+clean\b/i,
  /Remove-Item/i,
  /Move-Item/i,
  /Copy-Item/i
];

for (const pattern of forbidden) {
  assert(!pattern.test(text), `audit must remain non-destructive: ${pattern}`);
}

console.log("PASS production_divergence_audit_safety_test");
