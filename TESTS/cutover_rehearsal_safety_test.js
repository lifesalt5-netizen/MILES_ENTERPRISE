"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const bootstrap = fs.readFileSync(path.join(root, "StartMilesRehearsal.js"), "utf8");
const worker = fs.readFileSync(path.join(root, "StartProductionSystemRehearsal.js"), "utf8");
const runner = fs.readFileSync(path.join(root, "SCRIPTS", "RUN_MILES_CUTOVER_REHEARSAL.ps1"), "utf8");
const windowsRunner = fs.readFileSync(path.join(root, "SCRIPTS", "RUN_MILES_CUTOVER_REHEARSAL_WINDOWS.ps1"), "utf8");
const pm2Runner = fs.readFileSync(path.join(root, "SCRIPTS", "RUN_MILES_CUTOVER_REHEARSAL_PM2_WINDOWS.ps1"), "utf8");
const pm2Projector = fs.readFileSync(path.join(root, "SCRIPTS", "project_pm2_jlist.js"), "utf8");

for (const [name, text] of [["bootstrap", bootstrap], ["worker", worker], ["runner", runner], ["windowsRunner", windowsRunner], ["pm2Runner", pm2Runner], ["pm2Projector", pm2Projector]]) {
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

assert(/Get-CanonicalPortOwnerDetails/.test(windowsRunner), "Windows launcher must inspect exact canonical port ownership");
assert(/Get-CimInstance\s+Win32_Process/.test(windowsRunner), "Windows launcher must resolve owning process metadata");
assert(/Test-MilesRootOwnedCommandLine/.test(windowsRunner), "Windows launcher must qualify a process against MILES roots before stopping it");
assert(/\$detail\.name\s+-ieq\s+'node\.exe'/.test(windowsRunner), "Only Node processes may receive orphan cleanup");
assert(/\$detail\.miles_root_owned/.test(windowsRunner), "Orphan cleanup must require MILES root ownership");
assert(/Refusing to kill unrelated processes/.test(windowsRunner), "Unrelated canonical port owners must block rather than be killed");
assert(/Assert-CanonicalPortsReleased/.test(windowsRunner), "Windows launcher must prove canonical ports are released before candidate boot");

assert(/pm2\s+jlist/i.test(pm2Runner), "PM2 launcher must inspect the PM2 process table");
assert(/project_pm2_jlist\.js/i.test(pm2Runner), "PM2 launcher must use the checked-in projector");
assert(!/\bnode\s+-e\b/i.test(pm2Runner), "PM2 launcher must not use inline node eval on Windows");
assert(/JSON\.parse/.test(pm2Projector), "PM2 projector must parse raw jlist with Node");
assert(/pm_cwd/.test(pm2Projector), "PM2 projector must project each app cwd");
assert(/pm_exec_path/.test(pm2Projector), "PM2 projector must project each app executable path");
assert(!/\$raw\s*\|\s*ConvertFrom-Json/i.test(pm2Runner), "Raw PM2 jlist must never be parsed by Windows PowerShell ConvertFrom-Json");
assert(/username and USERNAME/i.test(pm2Runner), "PM2 duplicate-key Windows regression must remain documented");
assert(!/foreach\s*\(\s*\$pid\b/i.test(pm2Runner), "PM2 launcher must not assign to PowerShell's read-only $PID automatic variable");
assert(/foreach\s*\(\s*\$ownerPid\b/i.test(pm2Runner), "PM2 launcher must use a non-reserved variable for listener owner PIDs");
assert(/Get-LiveRootPm2State/.test(pm2Runner), "PM2 launcher must inventory every live-root PM2 entry regardless of status");
assert(/restore=\[bool\]\(\$wasOnline\s+-or\s+\$hadPid\s+-or\s+\$ownedCanonicalPort\)/i.test(pm2Runner), "PM2 launcher must preserve the pre-rehearsal active restore set");
assert(/Test-PathInsideRoot/.test(pm2Runner), "PM2 launcher must prove PM2 app ownership by live MILES root");
assert(/PM2 entries outside the live MILES root are never touched/i.test(pm2Runner), "PM2 launcher must document unrelated-app protection");
assert(/foreach\s*\(\$app\s+in\s+\$pm2Apps\)[\s\S]*?pm2\s+stop\s+\$app\.pm_id/i.test(pm2Runner), "PM2 launcher must stop every resolved live-root PM2 entry");
assert(/foreach\s*\(\$app\s+in\s+\$restoreApps\)[\s\S]*?pm2\s+restart\s+\$app\.pm_id/i.test(pm2Runner), "PM2 launcher must restore only the original active set");
assert(/Stop-RootOwnedNodeProcesses/.test(pm2Runner), "PM2 launcher must remove direct live/candidate Node runtimes around PM2 restoration");
assert(/Removing any direct live\/candidate Node runtime before PM2 restoration/i.test(pm2Runner), "PM2 launcher must clean direct runtime before PM2 restoration");
assert(/finally\s*\{/i.test(pm2Runner), "PM2 restoration must be protected by a finally block");
assert(/RUN_MILES_CUTOVER_REHEARSAL_WINDOWS\.ps1/i.test(pm2Runner), "PM2 launcher must delegate candidate validation to the Windows rehearsal runner");

const combined = `${bootstrap}\n${worker}\n${runner}\n${windowsRunner}\n${pm2Runner}\n${pm2Projector}`;
const forbidden = [
  /\bgit\s+(?:push|reset|clean|checkout|merge)\b/i,
  /INSTANTLY_WRITE_ENABLED\s*=\s*["']true["']/i,
  /MILES_CONTROLLED_WRITE_ENABLED\s*=\s*["']true["']/i,
  /\bpm2\s+(?:delete|kill|save)\b/i
];
for (const pattern of forbidden) {
  assert(!pattern.test(combined), `Forbidden rehearsal behavior detected: ${pattern}`);
}

console.log("PASS cutover_rehearsal_safety_test");
