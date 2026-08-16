"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { runPm2, parsePm2Jlist } = require("./ReconcilePm2Process");

const ROOT = process.env.MILES_ROOT || process.cwd();
const OUT_DIR = path.join(ROOT, "DATA", "runtime_guardian");
const MEMORY_FILE = path.join(OUT_DIR, "worker_memory_latest.json");
const ACCEPTANCE = path.join(ROOT, "SCRIPTS", "TestMilesProductionRecoveryAcceptanceP0.js");
const WARN_MB = Number(process.env.MILES_WORKER_MEMORY_WARN_MB || 1024);
const HARD_MB = Number(process.env.MILES_WORKER_MEMORY_FAIL_MB || 3072);

function sample() {
  try {
    const apps = parsePm2Jlist(runPm2(["jlist"]).stdout);
    const worker = apps.find(app => app.name === "miles-worker");
    if (!worker) return null;
    const rssMb = Math.round(Number(worker?.monit?.memory || 0) / 1024 / 1024);
    const record = {
      service: "miles-worker",
      pid: Number(worker.pid || 0),
      sampledAt: new Date().toISOString(),
      rssMb,
      heapUsedMb: null,
      heapTotalMb: null,
      externalMb: null,
      warnMb: WARN_MB,
      hardMb: HARD_MB,
      source: "PM2_LIVE_MEMORY_DIRECT_NODE_CLI"
    };
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(record, null, 2), "utf8");
    return record;
  } catch (error) {
    console.error(`[MILES MEMORY SAMPLE] ${error.message}`);
    return null;
  }
}

sample();
const timer = setInterval(sample, 2000);

const child = spawn(process.execPath, [ACCEPTANCE], {
  cwd: ROOT,
  env: { ...process.env, MILES_ROOT: ROOT },
  stdio: "inherit",
  windowsHide: true
});

child.on("error", error => {
  clearInterval(timer);
  sample();
  console.error(error.stack || error.message);
  process.exitCode = 1;
});

child.on("exit", code => {
  clearInterval(timer);
  const finalMemory = sample();
  if (finalMemory) {
    console.log(`Live worker memory after acceptance: ${finalMemory.rssMb} MB (pid=${finalMemory.pid})`);
  }
  process.exitCode = Number(code || 0);
});
