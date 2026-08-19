"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const script = fs.readFileSync(
  path.join(root, "SCRIPTS", "RUN_MILES_RECONCILIATION_STAGE4_BUNDLE.ps1"),
  "utf8"
);

assert(/Stage 3 report is not OK/i.test(script), "Stage 4 must require Stage 3 OK");
assert(/shadow_only_overlay/i.test(script), "Stage 4 must require Stage 3 shadow-only certification");
assert(/Shadow HEAD changed after Stage 3/i.test(script), "Stage 4 must pin shadow HEAD to the Stage 3 base");
assert(/not explicitly approved in Stage 3/i.test(script), "Stage 4 must reject unapproved shadow files");
assert(/hash changed after Stage 3/i.test(script), "Stage 4 must re-verify Stage 3 file hashes");
assert(/Potential embedded secret literal detected/i.test(script), "Stage 4 must block likely embedded secrets");
assert(/live_checkout_modified=\$false/i.test(script), "Stage 4 must report live checkout untouched");
assert(/remote_repository_modified=\$false/i.test(script), "Stage 4 must report GitHub untouched");
assert(/git_push_performed=\$false/i.test(script), "Stage 4 must not push");
assert(/git_merge_performed=\$false/i.test(script), "Stage 4 must not merge");
assert(/MILES_STAGE4_INTEGRATION_BUNDLE_/i.test(script), "Stage 4 must produce a reviewable ZIP bundle");

const forbidden = [
  /\bgit\s+push\b/i,
  /\bgit\s+merge\b/i,
  /\bgit\s+rebase\b/i,
  /\bgit\s+reset\b/i,
  /\bgit\s+clean\b/i,
  /--allow-unrelated-histories/i,
  /StartMilesProduction\.js\s*$/im,
  /RUN_P2GC_REPLY_INTELLIGENCE\.js\s*$/im,
  /RUN_P2GC_WINBACK_CAMPAIGN\.js\s*$/im,
  /RUN_CAPTURE_CAPACITY_CAMPAIGN\.js\s*$/im
];
for (const pattern of forbidden) {
  assert(!pattern.test(script), `Stage 4 must remain packaging-only: ${pattern}`);
}

console.log("PASS reconciliation_stage4_bundle_safety_test");
