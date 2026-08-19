"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const script = fs.readFileSync(path.join(root, "SCRIPTS", "RUN_MILES_RECONCILIATION_STAGE1.ps1"), "utf8");

assert(/worktree add --detach/i.test(script), "stage 1 should build a detached shadow worktree");
assert(/origin\/main/i.test(script), "shadow must be pinned to origin/main");
assert(/AUDIT_MILES_LIVE_SOURCE_RECONCILIATION\.ps1/i.test(script), "stage 1 should run the source reconciliation audit");
assert(/MILES_ALLOW_INSTANTLY_MUTATIONS\s*=\s*'false'/i.test(script), "Instantly mutations must be disabled");
assert(/MILES_AUTONOMOUS_EXECUTE\s*=\s*'false'/i.test(script), "autonomous execution must be disabled");
assert(/MILES_DRY_RUN\s*=\s*'true'/i.test(script), "dry run must be forced");
assert(/node --check/i.test(script), "shadow source should receive syntax validation");
assert(/reply_intelligence_classification_test\.js/i.test(script), "reply intelligence tests should run");
assert(/winback_local_history_test\.js/i.test(script), "Win-Back tests should run");
assert(/capture_capacity_source_bootstrap_test\.js/i.test(script), "Capture Capacity tests should run");
assert(/env_loaded\s*=\s*\$false/i.test(script), "report must confirm .env was not loaded");
assert(/production_started\s*=\s*\$false/i.test(script), "report must confirm production was not started");
assert(/live_checkout_modified\s*=\s*\$false/i.test(script), "report must confirm live checkout was not modified");

const forbidden = [
  /\bgit\s+merge\b/i,
  /\bgit\s+rebase\b/i,
  /\bgit\s+reset\b/i,
  /\bgit\s+clean\b/i,
  /\bgit\s+stash\b/i,
  /--allow-unrelated-histories/i,
  /StartMilesProduction\.js\s*(?:2>&1|$)/im,
  /RUN_P2GC_REPLY_INTELLIGENCE\.js\s*(?:2>&1|$)/im,
  /RUN_P2GC_WINBACK_CAMPAIGN\.js\s*(?:2>&1|$)/im,
  /RUN_CAPTURE_CAPACITY_PROSPECT_DISCOVERY\.js\s*(?:2>&1|$)/im,
  /Copy-Item[^\n]*\.env/i
];
for (const pattern of forbidden) {
  assert(!pattern.test(script), `stage 1 must not perform unsafe integration/runtime action: ${pattern}`);
}

console.log("PASS reconciliation_stage1_safety_test");
