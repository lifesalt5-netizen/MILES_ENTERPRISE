"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");

function text(file) { return fs.readFileSync(path.join(root, file), "utf8"); }

const guard = text("SCRIPTS/RuntimeGenerationGuard.js");
const maintainer = text("SCRIPTS/TaskQueueMaintenanceService.js");
const coo = text("StartAutonomousCOO.js");
const cutover = text("SCRIPTS/RUN_MILES_FULL_RUNTIME_STABILITY_CUTOVER_WINDOWS.ps1");

assert.match(guard, /generation superseded/);
assert.match(guard, /MILES_RUNTIME_GENERATION/);
assert.match(guard, /taskkill/);
assert.match(maintainer, /24 \* MB/);
assert.match(maintainer, /12 \* MB/);
assert.match(coo, /loop\.stop\(\)/);
assert.match(coo, /process\.exit\(0\)/);
assert.match(cutover, /CompactTaskQueueHistory\.js/);
assert.match(cutover, /True PM2 orphans/);
assert.match(cutover, /FULL RUNTIME STABILITY ACCEPTED/);
assert.match(cutover, /MILES_ACCEPT_WORKER_AVG_CPU_PCT/);
assert.match(cutover, /MILES_ACCEPT_COO_AVG_CPU_PCT/);
assert.match(cutover, /MILES_ACCEPT_MAX_RAM_GROWTH_MB/);
assert.match(cutover, /MILES_ACCEPT_MAX_RAM_GROWTH_PCT/);
assert.match(cutover, /MILES_ACCEPT_MAX_QUEUE_MB/);
assert.match(cutover, /Win32_PerfFormattedData_PerfProc_Process/);
assert.match(cutover, /Resource acceptance/);
assert.match(cutover, /resourceHealthy/);
assert.match(cutover, /miles-worker/);
assert.match(cutover, /miles-autonomous-coo/);
assert.match(cutover, /miles-queue-maintainer/);

// Windows cutover regression: invoke the npm .cmd shim so the `--` separator
// and RuntimeGenerationGuard arguments reach the child unchanged.
assert.match(cutover, /Get-Command 'pm2\.cmd'/);
assert.match(cutover, /\$workerStartArgs = @\('start',\$guard,'--name','miles-worker','--','--runtime','miles-worker','--entry','StartProductionSystem\.js'\)/);
assert.match(cutover, /& \$pm2Cmd @workerStartArgs/);
assert.match(cutover, /\$cooStartArgs = @\('start',\$guard,'--name','miles-autonomous-coo','--','--runtime','miles-autonomous-coo','--entry','StartAutonomousCOO\.js','--arg','--loop'\)/);
assert.match(cutover, /& \$pm2Cmd @cooStartArgs/);

// Missing guarded PM2 names are an idempotent cleanup condition, not a fatal error.
assert.match(cutover, /\$currentPm2Names -contains \$name/);
assert.match(cutover, /delete skipped/);
assert.doesNotMatch(cutover, /& pm2 delete \$name/);
assert.doesNotMatch(cutover, /& pm2 start \$guard/);

console.log("FULL_RUNTIME_STABILITY_TEST: GREEN");
