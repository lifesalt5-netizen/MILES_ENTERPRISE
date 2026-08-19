"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const bootstrap = fs.readFileSync(path.join(root, "StartMilesRehearsal.js"), "utf8");
const worker = fs.readFileSync(path.join(root, "StartProductionSystemRehearsal.js"), "utf8");
const runner = fs.readFileSync(path.join(root, "SCRIPTS", "RUN_MILES_CUTOVER_REHEARSAL.ps1"), "utf8");
const windowsRunner = fs.readFileSync(path.join(root, "SCRIPTS", "RUN_MILES_CUTOVER_REHEARSAL_WINDOWS.ps1"), "utf8");

for (const [name, text] of [["bootstrap", bootstrap], ["worker", worker], ["runner", runner], ["windowsRunner", windowsRunner]]) {
  assert([...Buffer.from(text, "utf8")].every(byte => byte < 0x80), `${name} must remain ASCII-only for Windows PowerShell/runtime safety`);
}

assert(/MILES_REHEARSAL_MODE\s*=\s*"true"/i.test(bootstrap), "Rehearsal mode must be explicit");
assert(/MILES_CONTROLLED_WRITE_ENABLED\s*=\s*"false"/i.test(bootstrap), "Controlled writes must be disabled");
assert(/INSTANTLY_WRITE_ENABLED\s*=\s*"false"/i.test(bootstrap), "Instantly writes must be disabled");
assert(/MILES_AUTONOMOUS_EXECUTE\s*=\s*"false"/i.test(bootstrap), "Autonomous execution must be disabled");
assert(/MILES_AUTONOMOUS_QUEUE_WORKFLOWS\s*=\s*"false"/i.test(bootstrap), "Workflow queueing must be disabled");
assert(/StartProductionSystemRehearsal\.js/.test(bootstrap), "Rehearsal bootstrap must substitute the zero-execution worker runtime");

assert(/startExecutionLoopRehearsal/.test(worker), "Worker execution loop must be overridden");
assert(/Worker task execution DISABLED/.test(worker), "Worker must announce execution disabled");
assert(/startAutonomousWorkLoopRehearsal/.test(worker), "Autonomous work loop must be overridden");
assert(/Autonomous work generation DISABLED/.test(worker), "Worker must announce work generation disabled");

assert(/StartMilesRehearsal\.js/.test(runner), "PowerShell rehearsal must launch rehearsal bootstrap");
assert(/StartMilesProduction\.js/.test(runner), "PowerShell rehearsal must restore prior production bootstrap");
assert(/finally\s*\{/i.test(runner), "Live restoration must be protected by a finally block");
assert(/prior_live_runtime_restored/i.test(runner), "Rehearsal report must record live restoration");
assert(/production_source_files_migrated\s*=\s*\$false/i.test(runner), "Rehearsal must certify no production source migration");
assert(/github_modified_by_rehearsal\s*=\s*\$false/i.test(runner), "Rehearsal must certify no GitHub mutation");

assert(/rev-parse\s+HEAD/i.test(windowsRunner), "Windows launcher must independently resolve the full candidate HEAD");
assert(/actualHead\.Trim\(\)/.test(windowsRunner), "Windows launcher must normalize the full SHA before comparison");
assert(/actualHead\s+-ne\s+\$ExpectedCommit/i.test(windowsRunner), "Windows launcher must enforce the exact expected commit");
assert(/\$headValues\s*=\s*@\(Get-GitValue/.test(windowsRunner), "Windows launcher patch must force array semantics before indexing HEAD");
assert(/Expected exactly one candidate HEAD value/.test(windowsRunner), "Windows launcher must require exactly one HEAD value");

const forbidden = [
  /\bgit\s+(?:push|reset|clean|checkout|merge)\b/i,
  /INSTANTLY_WRITE_ENABLED\s*=\s*["']true["']/i,
  /MILES_CONTROLLED_WRITE_ENABLED\s*=\s*["']true["']/i
];
for (const pattern of forbidden) {
  assert(!pattern.test(`${bootstrap}\n${worker}\n${runner}\n${windowsRunner}`), `Forbidden rehearsal behavior detected: ${pattern}`);
}

console.log("PASS cutover_rehearsal_safety_test");
