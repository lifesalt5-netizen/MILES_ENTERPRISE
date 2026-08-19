"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const scriptPath = path.join(root, "SCRIPTS", "AUDIT_MILES_PRODUCTION_ACCEPTANCE.ps1");
const scriptBuffer = fs.readFileSync(scriptPath);
const script = scriptBuffer.toString("utf8");

assert(
  [...scriptBuffer].every(byte => byte < 0x80),
  "Go-live acceptance audit must remain ASCII-only for Windows PowerShell 5.1 parser safety"
);
assert(/READ ONLY/i.test(script), "Go-live acceptance audit must be read-only");
assert(/ready_for_daily_use/i.test(script), "Audit must produce a daily-use readiness decision");
assert(/3000,8787,3737,8737/i.test(script), "Audit must verify the canonical MILES ports");
assert(/StartMilesProduction\.js/i.test(script), "Audit must validate production bootstrap entrypoint");
assert(/StartProductionSystem\.js/i.test(script), "Audit must validate worker runtime entrypoint");
assert(/StartAutonomousCOO\.js/i.test(script), "Audit must validate Autonomous COO entrypoint");
assert(/MilesCommandCenter\.js/i.test(script), "Audit must validate Command Center entrypoint");
assert(/StartExecutiveDashboard\.js/i.test(script), "Audit must validate Executive Dashboard entrypoint");
assert(/worker_runtime_status\.json/i.test(script), "Audit must inspect worker runtime status");
assert(/INSTANTLY_API_KEY/i.test(script), "Audit must inspect Instantly credential-key availability");
assert(/env_values_read_or_reported=\$false/i.test(script), "Audit must not report environment values");
assert(/mojibake_detected/i.test(script), "Audit must detect dashboard mojibake");
assert(/0x0393/i.test(script) && /0xFFFD/i.test(script), "Audit must detect mojibake using encoding-safe character codes");
assert(/\$dashboardHttpOk/i.test(script), "Audit must normalize dashboard HTTP health to an explicit boolean");
assert(/\$dashboardStateOk/i.test(script), "Audit must normalize dashboard state health to an explicit boolean");
assert(!/Invoke-HttpProbe\s+'[^']+'\s*,/i.test(script), "HTTP probe statements must not use trailing commas in Windows PowerShell");
assert(/BLOCKER:/i.test(script) && /WARNING:/i.test(script), "Audit must print blocker and warning names, not counts only");
assert(/reply_global_suppression_connector_test/i.test(script), "Audit must verify reply/global suppression safety coverage exists");
assert(/winback_production_loop_test/i.test(script), "Audit must verify Win-Back safety coverage exists");
assert(/capture_capacity_production_loop_test/i.test(script), "Audit must verify Capture Capacity safety coverage exists");
assert(/source_files_written=\$false/i.test(script), "Audit must certify no source writes");
assert(/processes_stopped=\$false/i.test(script), "Audit must certify no process stops");
assert(/processes_started=\$false/i.test(script), "Audit must certify no process starts");
assert(/outbound_runner_invoked=\$false/i.test(script), "Audit must certify no outbound runner invocation");
assert(/instantly_mutations_allowed=\$false/i.test(script), "Audit must certify no Instantly mutations");

const forbidden = [
  /\bStop-Process\b/i,
  /\bStart-Process\b/i,
  /&\s*git\s+(?:push|merge|reset|clean|checkout)\b/i,
  /\bCopy-Item\b/i,
  /\bMove-Item\b/i,
  /\bRemove-Item\b/i,
  /RUN_P2GC_REPLY_INTELLIGENCE\.js\s*$/im,
  /RUN_P2GC_WINBACK_CAMPAIGN\.js\s*$/im,
  /RUN_CAPTURE_CAPACITY_CAMPAIGN\.js\s*$/im
];
for (const pattern of forbidden) {
  assert(!pattern.test(script), `Go-live acceptance audit must remain read-only: ${pattern}`);
}

console.log("PASS production_go_live_acceptance_audit_safety_test");
