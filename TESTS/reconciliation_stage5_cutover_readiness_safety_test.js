"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const script = fs.readFileSync(
  path.join(root, "SCRIPTS", "AUDIT_MILES_CUTOVER_READINESS.ps1"),
  "utf8"
);

assert(/PLAN ONLY/i.test(script), "Stage 5 must be plan-only");
assert(/candidate_git_clean/i.test(script), "Stage 5 must inspect candidate Git cleanliness");
assert(/commit_matches_expected/i.test(script), "Stage 5 must validate the expected commit");
assert(/package-lock\.json/i.test(script), "Stage 5 must require the lockfile");
assert(/Read-EnvKeyNames/i.test(script), "Stage 5 may inspect environment key names only");
assert(/env_values_read_or_reported=\$false/i.test(script), "Stage 5 must certify that env values are not reported");
assert(/Get-NetTCPConnection/i.test(script), "Stage 5 must inspect production port ownership");
assert(/Get-CimInstance Win32_Process/i.test(script), "Stage 5 must inspect current MILES processes");
assert(/rollback_ready/i.test(script), "Stage 5 must validate rollback readiness");
assert(/StartMilesProduction\.js/i.test(script), "Stage 5 must validate the canonical production bootstrap entrypoint");
assert(/StartAutonomousCOO\.js/i.test(script), "Stage 5 must validate Autonomous COO entrypoint");
assert(/MilesCommandCenter\.js/i.test(script), "Stage 5 must validate Command Center entrypoint");
assert(/StartExecutiveDashboard\.js/i.test(script), "Stage 5 must validate Executive Dashboard entrypoint");
assert(/processes_stopped=\$false/i.test(script), "Stage 5 must not stop processes");
assert(/processes_started=\$false/i.test(script), "Stage 5 must not start processes");
assert(/git_push_performed=\$false/i.test(script), "Stage 5 must not push Git");
assert(/git_merge_performed=\$false/i.test(script), "Stage 5 must not merge Git");
assert(/instantly_mutations_allowed=\$false/i.test(script), "Stage 5 must not allow Instantly mutations");

// Detect executable mutations, not explanatory strings such as "no Git push/merge".
const forbiddenCommands = [
  /\bStop-Process\b/i,
  /\bStart-Process\b/i,
  /&\s*git\s+(?:push|merge|reset|clean)\b/i,
  /Invoke-GitProbe[^\r\n]*(?:\s|['"])(?:push|merge|reset|clean)(?:\s|['"]|$)/i,
  /&\s*npm\s+(?:ci|install)\b/i,
  /\bCopy-Item\b/i,
  /\bMove-Item\b/i,
  /\bRemove-Item\b/i
];
for (const pattern of forbiddenCommands) {
  assert(!pattern.test(script), `Stage 5 readiness audit must remain read-only: ${pattern}`);
}

console.log("PASS reconciliation_stage5_cutover_readiness_safety_test");
