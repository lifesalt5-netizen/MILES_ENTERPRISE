"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const script = fs.readFileSync(
  path.join(root, "SCRIPTS", "RUN_MILES_RECONCILIATION_STAGE3_OVERLAY.ps1"),
  "utf8"
);

assert(/Stage2Manifest/i.test(script), "Stage 3 must require Stage 2 manifest evidence");
assert(/DecisionManifest/i.test(script), "Stage 3 must require an explicit decision manifest");
assert(/expected_origin_main/i.test(script), "Stage 3 must pin decisions to the reviewed origin\/main commit");
assert(/Shadow HEAD changed since review/i.test(script), "Stage 3 must fail if the shadow base changed after review");
assert(/LIVE_HASH_CHANGED_SINCE_STAGE2/i.test(script), "Stage 3 must fail if reviewed live source changed after Stage 2");
assert(/NOT_IN_STAGE2_MANIFEST/i.test(script), "Stage 3 must reject files not present in Stage 2 review");
assert(/NOT_P0_P1/i.test(script), "Stage 3 must restrict overlay to P0/P1 candidates");
assert(/SENSITIVE_AUTOMATIC_OVERLAY_BLOCKED/i.test(script), "Stage 3 must block automatic sensitive\/config overlay");
assert(/KEEP_LOCAL/.test(script) && /USE_REMOTE/.test(script) && /RETIRE/.test(script) && /MERGED_SOURCE/.test(script), "Stage 3 must use explicit preservation actions");
assert(/MERGED_SOURCE_HASH_MISMATCH/i.test(script), "reviewed merged source must be hash pinned");
assert(/MILES_ALLOW_INSTANTLY_MUTATIONS\s*=\s*'false'/i.test(script), "Instantly mutations must remain disabled during Stage 3 validation");
assert(/MILES_AUTONOMOUS_EXECUTE\s*=\s*'false'/i.test(script), "autonomous execution must remain disabled during Stage 3 validation");
assert(/CAPTURE_CAPACITY_AUTO_STAGE\s*=\s*'false'/i.test(script), "capture auto staging must remain disabled during Stage 3 validation");
assert(/live_checkout_modified=\$false/i.test(script), "report must record that live checkout remains untouched");
assert(/Shadow is not clean before Stage 3 overlay/i.test(script), "Stage 3 must require a clean shadow before overlay");
assert(/winback_reconstruction_test\.js/i.test(script), "Stage 3 must rerun Win-Back validation");
assert(/reply_intelligence_classification_test\.js/i.test(script), "Stage 3 must rerun Reply Intelligence validation");
assert(/capture_capacity_production_loop_test\.js/i.test(script), "Stage 3 must rerun Capture Capacity validation");

const destructiveLiveGit = [
  /git\s+merge\b/i,
  /git\s+rebase\b/i,
  /git\s+reset\b/i,
  /git\s+clean\b/i,
  /--allow-unrelated-histories/i
];
for (const pattern of destructiveLiveGit) {
  assert(!pattern.test(script), `Stage 3 must not contain destructive live Git integration: ${pattern}`);
}

console.log("PASS reconciliation_stage3_overlay_safety_test");
