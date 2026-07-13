"use strict";

/*
  MILES OS
  File: StartMilesProduction.js
  Version: 1.1.0
  Purpose: Resident production supervisor for MILES Digital COO.
*/

require("dotenv").config();

const { spawn } = require("child_process");
const path = require("path");

const ROOT = __dirname;
const RESTART_DELAY_MS = Number(process.env.MILES_RESTART_DELAY_MS || 5000);
const HEARTBEAT_MS = Number(process.env.MILES_BOOTSTRAP_HEARTBEAT_MS || 30000);

const processes = [
  {
    name: "Desktop UI",
    file: "StartMiles.js",
    enabled: true
  },
  {
    name: "Worker Runtime",
    file: "StartProductionSystem.js",
    enabled: true
  },
  {
    name: "Autonomous COO",
    file: "StartAutonomousCOO.js",
    args: ["--loop"],
    enabled: true
  },
  {
    name: "Miles Command Center",
    file: path.join("SERVICES", "digital_coo", "MilesCommandCenter.js"),
    enabled: true
  }
];

const children = new Map();
let shuttingDown = false;

function log(message) {
  console.log(`[MILES BOOTSTRAP] ${message}`);
}

function scriptPathFor(proc) {
  return path.join(ROOT, proc.file);
}

function startProcess(proc) {
  if (!proc.enabled) {
    log(`Skipping disabled service: ${proc.name}`);
    return;
  }

  const existing = children.get(proc.name);

  if (existing && !existing.child.killed) {
    log(`${proc.name} already running. pid=${existing.child.pid}`);
    return;
  }

  const scriptPath = scriptPathFor(proc);

  log(`Starting ${proc.name}: ${proc.file}`);

  const child = spawn("node", [scriptPath, ...(proc.args || [])], {
    cwd: ROOT,
    shell: false,
    stdio: "inherit",
    env: {
      ...process.env,
      MILES_PRODUCTION_BOOTSTRAP: "true"
    }
  });

  children.set(proc.name, {
    proc,
    child,
    startedAt: new Date().toISOString(),
    restartCount: existing ? existing.restartCount + 1 : 0
  });

  child.on("error", (err) => {
    log(`${proc.name} failed to start: ${err.message}`);
  });

  child.on("exit", (code, signal) => {
    const record = children.get(proc.name);

    log(`${proc.name} exited. code=${code} signal=${signal}`);

    if (record && record.child.pid === child.pid) {
      children.delete(proc.name);
    }

    if (!shuttingDown && proc.enabled) {
      log(`${proc.name} will restart in ${RESTART_DELAY_MS}ms.`);
      setTimeout(() => {
        if (!shuttingDown) {
          startProcess(proc);
        }
      }, RESTART_DELAY_MS);
    }
  });
}

function startAll() {
  for (const proc of processes) {
    startProcess(proc);
  }
}

function statusSnapshot() {
  const services = [];

  for (const proc of processes) {
    const record = children.get(proc.name);

    services.push({
      name: proc.name,
      file: proc.file,
      enabled: proc.enabled,
      running: Boolean(record && record.child && !record.child.killed),
      pid: record?.child?.pid || null,
      startedAt: record?.startedAt || null,
      restartCount: record?.restartCount || 0
    });
  }

  return {
    ok: true,
    service: "MILES_PRODUCTION_BOOTSTRAP",
    root: ROOT,
    shuttingDown,
    generatedAt: new Date().toISOString(),
    services
  };
}

function shutdown(signal = "MANUAL") {
  if (shuttingDown) return;

  shuttingDown = true;

  log(`Shutdown requested by ${signal}. Stopping child processes.`);

  for (const [name, record] of children.entries()) {
    try {
      log(`Stopping ${name}. pid=${record.child.pid}`);
      record.child.kill("SIGTERM");
    } catch (err) {
      log(`Failed stopping ${name}: ${err.message}`);
    }
  }

  setTimeout(() => {
    for (const [name, record] of children.entries()) {
      try {
        if (!record.child.killed) {
          log(`Force stopping ${name}. pid=${record.child.pid}`);
          record.child.kill("SIGKILL");
        }
      } catch (err) {
        log(`Failed force stopping ${name}: ${err.message}`);
      }
    }

    process.exit(0);
  }, 3000);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

process.on("uncaughtException", (error) => {
  log(`Uncaught exception: ${error.stack || error.message}`);
});

process.on("unhandledRejection", (reason) => {
  const message = reason && reason.stack ? reason.stack : String(reason);
  log(`Unhandled rejection: ${message}`);
});

log("=======================================");
log("MILES OS PRODUCTION BOOTSTRAP STARTING");
log("Role: Digital COO for P2GC");
log(`Root: ${ROOT}`);
log("Supervisor: Resident restart-enabled mode");
log("=======================================");

startAll();

log("All enabled MILES production runtimes launched.");
log("Desktop UI + Worker Runtime + Autonomous COO + Command Center are now supervised.");
log("Expected ports:");
log("- Desktop UI: http://localhost:3737");
log("- API: http://localhost:3000");
log("- Command Center: http://localhost:8787");

setInterval(() => {
  const snapshot = statusSnapshot();
  const running = snapshot.services.filter((s) => s.running).length;
  const enabled = snapshot.services.filter((s) => s.enabled).length;

  log(`Supervisor heartbeat. running=${running}/${enabled}`);

  for (const service of snapshot.services) {
    log(
      `${service.name}: ${service.running ? "RUNNING" : "DOWN"} pid=${service.pid || "none"} restarts=${service.restartCount}`
    );
  }
}, HEARTBEAT_MS);

// Keep the supervisor resident.
setInterval(() => {}, 1 << 30);