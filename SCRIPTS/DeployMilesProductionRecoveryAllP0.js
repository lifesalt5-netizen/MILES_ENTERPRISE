"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = process.env.MILES_ROOT || process.cwd();
const SCRIPTS = path.join(ROOT, "SCRIPTS");
const repairRuntime = process.argv.includes("--repair-runtime");

function read(rel) {
  try { return fs.readFileSync(path.join(ROOT, rel), "utf8"); }
  catch { return ""; }
}
function has(rel, marker) { return read(rel).includes(marker); }
function runNode(script, args = []) {
  const full = path.join(SCRIPTS, script);
  if (!fs.existsSync(full)) throw new Error(`Missing deployment component: ${full}`);
  const result = spawnSync(process.execPath, [full, ...args], { cwd: ROOT, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout || "", stderr: result.stderr || "" };
}
function syntax(rel) {
  const full = path.join(ROOT, rel);
  const result = spawnSync(process.execPath, ["--check", full], { cwd: ROOT, encoding: "utf8" });
  return { file: rel, ok: result.status === 0, error: (result.stderr || result.stdout || "").trim() };
}

const components = [
  { name:"TaskQueue process-wide lock", target:"CORE/TaskQueue.js", marker:"__MILES_TASKQUEUE_PROCESS_LOCKS", installer:"RepairTaskQueueProcessWideReentrantLockP0.js" },
  { name:"Worker RAM watchdog", target:"StartProductionSystem.js", marker:"MILES_WORKER_MEMORY_WATCHDOG_P0", installer:"InstallWorkerMemoryWatchdogP0.js" },
  { name:"Startup memory probe", target:"StartProductionSystem.js", marker:"MILES_STARTUP_MEMORY_PROBE_P0", installer:"InstallStartupMemoryProbeP0_v2.js" },
  { name:"Workforce memory cache", target:"SERVICES/WorkforceService.js", marker:"MILES_WORKFORCE_MEMORY_CACHE_P0", installer:"InstallWorkforceServiceMemoryCacheP0_v2.js" },
  { name:"Canonical revenue truth", target:"SERVICES/RevenueMissionSourceService.js", marker:"readCanonicalRevenueTruth()", installer:"InstallCanonicalRevenueTruthWiringP0_v2.js" },
  { name:"8787 workforce result truth", target:"SERVICES/ExecutiveResponseService.js", marker:"readWorkforceResult(taskId)", installer:"Install8787WorkforceResultTruthP0_v2.js" },
  { name:"8787 department execution truth", target:"SERVICES/digital_coo/DepartmentDashboardService.js", marker:"collectWorkforceResults()", installer:"Install8787DepartmentTruthP0.js" },
  { name:"8787 department UI", target:"SERVICES/digital_coo/public/app.js", marker:"refreshDepartmentBoard", installer:"InstallMiles8787DepartmentDashboardP0_v5.js" },
  { name:"Executive dashboard canonical truth", target:"SERVICES/DashboardDataService.js", marker:"truthSources:", installer:"InstallExecutiveDashboardTruthP0.js" },
  { name:"8787 demo truth routes", target:"SERVICES/digital_coo/MilesCommandCenter.js", marker:"DemoTruthReportService", installer:"Install8787DemoTruthRoutesP0.js" }
];

console.log("=== MILES PRODUCTION RECOVERY ALL P0 ===");
const outcomes = [];
for (const c of components) {
  if (has(c.target, c.marker)) {
    outcomes.push({ name:c.name, status:"ALREADY_INSTALLED" });
    console.log(`[SKIP] ${c.name}`);
    continue;
  }
  const result = runNode(c.installer);
  if (result.status !== 0) {
    console.error(`[FAIL] ${c.name}`);
    console.error((result.stderr || result.stdout).trim());
    outcomes.push({ name:c.name, status:"FAILED", detail:(result.stderr || result.stdout).trim() });
    break;
  }
  console.log(`[OK] ${c.name}`);
  outcomes.push({ name:c.name, status:"INSTALLED" });
}

const failedInstall = outcomes.some(x => x.status === "FAILED");
const checks = [
  "CORE/TaskQueue.js",
  "StartProductionSystem.js",
  "SERVICES/WorkforceService.js",
  "SERVICES/RevenueMissionSourceService.js",
  "SERVICES/ExecutiveResponseService.js",
  "SERVICES/DashboardDataService.js",
  "SERVICES/digital_coo/DepartmentDashboardService.js",
  "SERVICES/digital_coo/DemoTruthReportService.js",
  "SERVICES/digital_coo/MilesCommandCenter.js",
  "SERVICES/digital_coo/public/app.js"
].map(syntax);

for (const check of checks) {
  console.log(`${check.ok ? "[CHECK OK]" : "[CHECK FAIL]"} ${check.file}`);
  if (!check.ok && check.error) console.error(check.error);
}

let guardian = null;
let acceptance = null;
if (!failedInstall && checks.every(c => c.ok) && repairRuntime) {
  guardian = runNode("MilesProductionGuardian.js", ["--repair"]);
  process.stdout.write(guardian.stdout);
  process.stderr.write(guardian.stderr);

  if (guardian.status === 0) {
    acceptance = runNode("TestMilesProductionRecoveryAcceptanceP0.js");
    process.stdout.write(acceptance.stdout);
    process.stderr.write(acceptance.stderr);
  }
}

const report = {
  ok: !failedInstall && checks.every(c => c.ok) && (!repairRuntime || (guardian?.status === 0 && acceptance?.status === 0)),
  generatedAt: new Date().toISOString(),
  repairRuntime,
  outcomes,
  syntaxChecks: checks,
  guardianStatus: guardian ? guardian.status : null,
  acceptanceStatus: acceptance ? acceptance.status : null
};
const reportDir = path.join(ROOT, "DATA", "runtime_guardian");
fs.mkdirSync(reportDir, { recursive:true });
fs.writeFileSync(path.join(reportDir, "production_recovery_deploy_latest.json"), JSON.stringify(report,null,2), "utf8");
console.log("=== DEPLOY RESULT:", report.ok ? "PASS" : "FAIL", "===");
process.exitCode = report.ok ? 0 : 1;
