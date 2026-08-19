"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const script = fs.readFileSync(path.join(root, "SCRIPTS", "AUDIT_MILES_LIVE_SOURCE_RECONCILIATION.ps1"), "utf8");

assert(/git fetch origin main/i.test(script), "audit should refresh origin/main metadata");
assert(/origin\/main\.\.HEAD/i.test(script), "audit should inspect local-only commits");
assert(/diff-tree --root --no-commit-id --name-only/i.test(script), "audit should inventory files touched by local checkpoint commits");
assert(/hash-object/i.test(script), "audit should hash live working files without rewriting them");
assert(/rev-parse.*origin\/main/i.test(script), "audit should compare against origin/main blobs");
assert(/Get-CimInstance Win32_Process/i.test(script), "audit should inspect running Node entrypoints");
assert(/P0_RUNTIME_ENTRYPOINT|P0_REVENUE/i.test(script), "audit should classify revenue/runtime source risk");
assert(/BACKUPS\?|ARCHIVE|BUILD/i.test(script), "audit should filter backup/build debris");
assert(/MILES_SOURCE_RECONCILIATION_/i.test(script), "reports should be written outside the live repository");
assert(/live_checkout_modified\s*=\s*\$false/i.test(script), "report must assert live checkout is untouched");

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
  /Copy-Item/i,
  /Set-Content[^\n]*RepoRoot/i
];

for (const pattern of forbidden) {
  assert(!pattern.test(script), `source reconciliation audit must remain non-destructive: ${pattern}`);
}

console.log("PASS live_source_reconciliation_safety_test");
