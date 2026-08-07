"use strict";

/*
  MILES Enterprise
  File: StartMilesProduction.js
  Purpose: Deterministic, readiness-gated production bootstrap.
*/

require("dotenv").config();

const fs = require("fs");
const net = require("net");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = __dirname;
process.env.MILES_ROOT = ROOT;

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : fallback;
}

function buildProcessPlan(env = process.env) {
  return [
    {
      name: "Worker Runtime",
      file: "StartProductionSystem.js",
      phase: 1,
      readiness: [
        {
          type: "json-status",
          relativePath: path.join(
            "DATA",
            "runtime",
            "worker_runtime_status.json"
          )
        },
        {
          type: "tcp",
          host: "127.0.0.1",
          port: positiveNumber(env.MILES_API_PORT, 3000)
        }
      ]
    },
    {
      name: "Autonomous COO",
      file: "StartAutonomousCOO.js",
      args: ["--loop"],
      phase: 2,
      readiness: [
        {
          type: "stable-process",
          durationMs: positiveNumber(
            env.MILES_AUTONOMOUS_STARTUP_STABILITY_MS,
            2000
          )
        }
      ]
    },
    {
      name: "Miles Command Center",
      file: path.join(
        "SERVICES",
        "digital_coo",
        "MilesCommandCenter.js"
      ),
      phase: 3,
      readiness: [
        {
          type: "tcp",
          host: "127.0.0.1",
          port: positiveNumber(env.MILES_COMMAND_PORT, 8787)
        }
      ]
    },
    {
      name: "Desktop UI",
      file: "StartMiles.js",
      phase: 4,
      readiness: [
        {
          type: "tcp",
          host: "127.0.0.1",
          port: positiveNumber(env.MILES_PORT, 3737)
        }
      ]
    },
    {
      name: "Executive Dashboard",
      file: "StartExecutiveDashboard.js",
      phase: 5,
      readiness: [
        {
          type: "tcp",
          host: "127.0.0.1",
          port: positiveNumber(env.MILES_DASHBOARD_PORT, 8737)
        }
      ]
    }
  ];
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function processFailure(record) {
  if (record.startError) return record.startError;
  if (record.exited) {
    return new Error(
      `${record.proc.name} exited before readiness ` +
      `(code=${record.exitCode} signal=${record.exitSignal}).`
    );
  }
  return null;
}

async function waitUntil(check, record, options = {}) {
  const timeoutMs = positiveNumber(options.timeoutMs, 60000);
  const pollMs = positiveNumber(options.pollMs, 250);
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const failure = processFailure(record);
    if (failure) throw failure;
    if (await check()) return true;
    await delay(pollMs);
  }

  throw new Error(
    `${record.proc.name} readiness timed out after ${timeoutMs}ms.`
  );
}

function tcpReady(host, port, timeoutMs = 500) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host, port });
    let settled = false;

    const finish = value => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

async function waitForJsonStatus(root, descriptor, record, options) {
  const filePath = path.join(root, descriptor.relativePath);

  await waitUntil(() => {
    try {
      const stat = fs.statSync(filePath);
      if (stat.mtimeMs + 1000 < record.startedAtMs) return false;

      const status = JSON.parse(fs.readFileSync(filePath, "utf8"));
      return status.ok === true &&
        status.pid === record.child.pid &&
        status.lifecycle?.started === true &&
        status.lifecycle?.shuttingDown !== true;
    } catch {
      return false;
    }
  }, record, options);
}

async function waitForReadiness(root, record, options = {}) {
  for (const descriptor of record.proc.readiness || []) {
    if (descriptor.type === "json-status") {
      await waitForJsonStatus(root, descriptor, record, options);
      continue;
    }

    if (descriptor.type === "tcp") {
      await waitUntil(
        () => tcpReady(descriptor.host, descriptor.port),
        record,
        options
      );
      continue;
    }

    if (descriptor.type === "stable-process") {
      const stableAt = Date.now() + descriptor.durationMs;
      await waitUntil(
        () => Date.now() >= stableAt,
        record,
        {
          ...options,
          timeoutMs: Math.max(
            positiveNumber(options.timeoutMs, 60000),
            descriptor.durationMs + 1000
          )
        }
      );
      continue;
    }

    throw new Error(
      `Unknown readiness check for ${record.proc.name}: ` +
      descriptor.type
    );
  }
}

class ProductionBootstrapSupervisor {
  constructor(options = {}) {
    this.root = options.root || ROOT;
    this.env = options.env || process.env;
    this.spawnImpl = options.spawnImpl || spawn;
    this.log = options.log || (message => {
      console.log(`[MILES BOOTSTRAP] ${message}`);
    });
    this.restartDelayMs = positiveNumber(
      this.env.MILES_RESTART_DELAY_MS,
      5000
    );
    this.heartbeatMs = positiveNumber(
      this.env.MILES_BOOTSTRAP_HEARTBEAT_MS,
      30000
    );
    this.readinessTimeoutMs = positiveNumber(
      this.env.MILES_BOOTSTRAP_READINESS_TIMEOUT_MS,
      60000
    );
    this.processes = options.processes || buildProcessPlan(this.env);
    this.children = new Map();
    this.restartCounts = new Map();
    this.shuttingDown = false;
    this.startupComplete = false;
    this.heartbeatTimer = null;
  }

  validatePlan() {
    const names = new Set();
    let priorPhase = 0;

    for (const proc of this.processes) {
      if (names.has(proc.name)) {
        throw new Error(`Duplicate production process: ${proc.name}`);
      }
      names.add(proc.name);

      if (proc.phase <= priorPhase) {
        throw new Error("Production phases must be strictly increasing.");
      }
      priorPhase = proc.phase;

      const scriptPath = path.join(this.root, proc.file);
      if (!fs.existsSync(scriptPath)) {
        throw new Error(`Production entry point missing: ${scriptPath}`);
      }
    }
  }

  async startProcess(proc) {
    const existing = this.children.get(proc.name);
    if (existing && !existing.exited) return existing;

    const scriptPath = path.join(this.root, proc.file);
    const restartCount = this.restartCounts.get(proc.name) || 0;

    this.log(`Phase ${proc.phase}: starting ${proc.name}: ${proc.file}`);

    const child = this.spawnImpl(
      process.execPath,
      [scriptPath, ...(proc.args || [])],
      {
        cwd: this.root,
        shell: false,
        stdio: "inherit",
        env: {
          ...this.env,
          MILES_ROOT: this.root,
          MILES_PRODUCTION_BOOTSTRAP: "true"
        }
      }
    );

    const record = {
      proc,
      child,
      startedAt: new Date().toISOString(),
      startedAtMs: Date.now(),
      restartCount,
      ready: false,
      readyAt: null,
      exited: false,
      exitCode: null,
      exitSignal: null,
      startError: null
    };

    this.children.set(proc.name, record);

    child.once("error", error => {
      record.startError = error;
      this.log(`${proc.name} failed to start: ${error.message}`);
    });

    child.once("exit", (code, signal) => {
      record.exited = true;
      record.ready = false;
      record.exitCode = code;
      record.exitSignal = signal;
      this.log(`${proc.name} exited. code=${code} signal=${signal}`);

      if (!this.shuttingDown && this.startupComplete) {
        this.restartCounts.set(proc.name, record.restartCount + 1);
        setTimeout(() => {
          if (this.shuttingDown) return;
          this.startProcess(proc).catch(error => {
            this.log(`${proc.name} restart failed: ${error.message}`);
          });
        }, this.restartDelayMs);
      }
    });

    try {
      await waitForReadiness(this.root, record, {
        timeoutMs: this.readinessTimeoutMs
      });
      record.ready = true;
      record.readyAt = new Date().toISOString();
      this.log(`${proc.name}: READY pid=${child.pid}`);
      return record;
    } catch (error) {
      try {
        if (!record.exited) child.kill("SIGTERM");
      } catch {}
      throw error;
    }
  }

  async startAll() {
    this.validatePlan();

    for (const proc of this.processes) {
      await this.startProcess(proc);
    }

    this.startupComplete = true;
    this.startHeartbeat();
    return this.statusSnapshot();
  }

  statusSnapshot() {
    const services = this.processes.map(proc => {
      const record = this.children.get(proc.name);
      return {
        name: proc.name,
        file: proc.file,
        phase: proc.phase,
        running: Boolean(record && !record.exited),
        ready: Boolean(record && record.ready),
        pid: record?.child?.pid || null,
        startedAt: record?.startedAt || null,
        readyAt: record?.readyAt || null,
        restartCount: record?.restartCount || 0
      };
    });

    return {
      ok: this.startupComplete && services.every(item => item.ready),
      service: "MILES_PRODUCTION_BOOTSTRAP",
      root: this.root,
      startupComplete: this.startupComplete,
      shuttingDown: this.shuttingDown,
      generatedAt: new Date().toISOString(),
      services
    };
  }

  startHeartbeat() {
    this.heartbeatTimer = setInterval(() => {
      const snapshot = this.statusSnapshot();
      const ready = snapshot.services.filter(item => item.ready).length;
      this.log(`Supervisor heartbeat. ready=${ready}/${snapshot.services.length}`);
      for (const service of snapshot.services) {
        this.log(
          `${service.name}: ${service.ready ? "READY" : "DOWN"} ` +
          `pid=${service.pid || "none"} restarts=${service.restartCount}`
        );
      }
    }, this.heartbeatMs);
  }

  async shutdown(signal = "MANUAL") {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    this.startupComplete = false;
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);

    this.log(`Shutdown requested by ${signal}. Stopping child processes.`);

    const records = Array.from(this.children.values()).reverse();
    for (const record of records) {
      try {
        if (!record.exited) record.child.kill("SIGTERM");
      } catch (error) {
        this.log(`Failed stopping ${record.proc.name}: ${error.message}`);
      }
    }
  }
}

async function main() {
  const supervisor = new ProductionBootstrapSupervisor();

  console.log("[MILES BOOTSTRAP] MILES_ROOT:", ROOT);
  supervisor.log("=======================================");
  supervisor.log("MILES ENTERPRISE PRODUCTION BOOTSTRAP STARTING");
  supervisor.log("Role: Digital COO for P2GC");
  supervisor.log(`Root: ${ROOT}`);
  supervisor.log("Supervisor: deterministic readiness-gated mode");
  supervisor.log("=======================================");

  process.once("SIGINT", () => supervisor.shutdown("SIGINT"));
  process.once("SIGTERM", () => supervisor.shutdown("SIGTERM"));

  const result = await supervisor.startAll();
  supervisor.log("All production runtimes are READY.");
  supervisor.log("- API: http://localhost:3000");
  supervisor.log("- Command Center: http://localhost:8787");
  supervisor.log("- Desktop UI: http://localhost:3737");
  supervisor.log("- Executive Dashboard: http://localhost:8737");
  return result;
}

if (require.main === module) {
  main().catch(error => {
    console.error("[MILES BOOTSTRAP] STARTUP FAILED");
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  ProductionBootstrapSupervisor,
  buildProcessPlan,
  positiveNumber,
  tcpReady,
  waitForReadiness,
  main
};
