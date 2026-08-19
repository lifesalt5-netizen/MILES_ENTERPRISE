"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const scriptPath = path.join(root, "SCRIPTS", "RUN_MILES_RECONCILIATION_STAGE2_EXPORT.ps1");
const text = fs.readFileSync(scriptPath, "utf8");

assert(/fetch origin main/i.test(text), "stage2 should refresh origin/main metadata");
assert(/AUDIT_MILES_LIVE_SOURCE_RECONCILIATION\.ps1/i.test(text), "stage2 should rerun the read-only source reconciliation");
assert(/P0_RUNTIME_ENTRYPOINT/i.test(text), "stage2 should include P0 runtime candidates");
assert(/P0_REVENUE/i.test(text), "stage2 should include P0 revenue candidates");
assert(/P1_CONNECTOR/i.test(text), "stage2 should include P1 connector candidates");
assert(/Test-HistoricalCopyPath/i.test(text), "stage2 should exclude historical copies");
assert(/Redact-LikelySecrets/i.test(text), "stage2 should redact likely secret literals in review copies");
assert(/manifest_only_sensitive/i.test(text), "sensitive/config paths should be manifest-only");
assert(/node --check/i.test(text), "live JavaScript candidates should only be syntax checked");
assert(/Compress-Archive/i.test(text), "stage2 should emit a compact review zip");
assert(/live_checkout_modified = \$false/i.test(text), "stage2 must state that the live checkout is untouched");

const forbidden = [
  /\bgit\s+merge\b/i,
  /\bgit\s+rebase\b/i,
  /\bgit\s+reset\b/i,
  /\bgit\s+checkout\b/i,
  /\bgit\s+switch\b/i,
  /\bgit\s+stash\b/i,
  /\bgit\s+clean\b/i,
  /--allow-unrelated-histories/i,
  /StartMilesProduction\.js\s*(?:["']|\s)*$/im,
  /RUN_P2GC_REPLY_INTELLIGENCE\.js\s*(?:["']|\s)*$/im,
  /RUN_P2GC_WINBACK_CAMPAIGN\.js\s*(?:["']|\s)*$/im,
  /RUN_CAPTURE_CAPACITY_CAMPAIGN\.js\s*(?:["']|\s)*$/im,
  /Remove-Item/i,
  /Move-Item/i
];

for (const pattern of forbidden) {
  assert(!pattern.test(text), `stage2 export must remain non-destructive: ${pattern}`);
}

console.log("PASS reconciliation_stage2_export_safety_test");
