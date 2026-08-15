"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// MILES_8787_HEALTH_TRUTH_P0

const REQUIRED_SERVICES = Object.freeze([
  "Worker Runtime",
  "Autonomous COO",
  "Miles Command Center",
  "Desktop UI",
  "Executive Dashboard"
]);

const REQUIRED_PM2_APPS = Object.freeze([
  "miles-worker",
  "miles-ui",
  "miles-dashboard",
  "miles-command-center"
]);

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseTimestamp(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

class ExecutiveRuntimeHealthService {
  constructor(options = {}) {
    this.service = "EXECUTIVE_RUNTIME_HEALTH";
    this.rootDir =
      options.rootDir ||
      process.env.MILES_ROOT ||
      path.resolve(__dirname, "..", "..");

    this.runtimeDir =
      options.runtimeDir ||
      path.join(this.rootDir, "DATA", "runtime");

    this.bootstrapStatusFile =
      options.bootstrapStatusFile ||
      path.join(this.runtimeDir, "production_bootstrap_status.json");

    this.workerStatusFile =
      options.workerStatusFile ||
      path.join(this.runtimeDir, "worker_runtime_status.json");

    this.maxAgeMs = positiveNumber(
      options.maxAgeMs || process.env.MILES_EXECUTIVE_HEALTH_MAX_AGE_MS,
      90000
    );

    this.now = options.now || (() => Date.now());
  }

  readSnapshot(label, filePath) {
    if (!fs.existsSync(filePath)) {
      return { ok: false, label, status: "SNAPSHOT_MISSING", filePath };
    }

    try {
      const snapshot = JSON.parse(fs.readFileSync(filePath, "utf8"));
      const generatedAtMs = parseTimestamp(snapshot.generatedAt);

      if (generatedAtMs === null) {
        return {
          ok: false,
          label,
          status: "SNAPSHOT_TIMESTAMP_INVALID",
          filePath,
          snapshot
        };
      }

      const ageMs = Math.max(0, this.now() - generatedAtMs);
      if (ageMs > this.maxAgeMs) {
        return {
          ok: false,
          label,
          status: "SNAPSHOT_STALE",
          filePath,
          ageMs,
          maxAgeMs: this.maxAgeMs,
          snapshot
        };
      }

      return {
        ok: true,
        label,
        status: "SNAPSHOT_CURRENT",
        filePath,
        ageMs,
        snapshot
      };
    } catch (error) {
      return {
        ok: false,
        label,
        status: "SNAPSHOT_INVALID",
        filePath,
        error: error.message
      };
    }
  }

  livePm2Runtime() {
    try {
      const raw = execSync("pm2 jlist", {
        cwd: this.rootDir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"]
      });
      const apps = JSON.parse(raw);
      const byName = new Map(apps.map(app => [app.name, app]));
      const services = REQUIRED_PM2_APPS.map(name => {
        const app = byName.get(name);
        const online = app?.pm2_env?.status === "online";
        return {
          name,
          running: online,
          ready: online,
          pid: Number(app?.pid || 0) || null,
          restartCount: Number(app?.pm2_env?.restart_time || 0),
          memoryMB: Math.round(Number(app?.monit?.memory || 0) / 1024 / 1024)
        };
      });
      const ok = services.every(service => service.running && service.ready && service.pid);

      return {
        ok,
        status: ok ? "HEALTHY" : "DEGRADED",
        source: "PM2_LIVE",
        services,
        serviceCount: services.length,
        requiredServiceCount: REQUIRED_PM2_APPS.length,
        readyCount: services.filter(service => service.ready).length,
        runningCount: services.filter(service => service.running).length,
        restartCount: services.reduce((total, service) => total + service.restartCount, 0),
        generatedAt: new Date(this.now()).toISOString()
      };
    } catch (error) {
      return {
        ok: false,
        status: "UNAVAILABLE",
        source: "PM2_LIVE",
        error: error.message
      };
    }
  }

  validateProductionRuntime(result) {
    if (!result.ok) return result;

    const snapshot = result.snapshot;
    const services = Array.isArray(snapshot.services) ? snapshot.services : [];
    const byName = new Map(services.map(service => [service.name, service]));

    const requiredServices = REQUIRED_SERVICES.map(name => {
      const service = byName.get(name);
      return {
        name,
        running: service?.running === true,
        ready: service?.ready === true,
        pid: service?.pid || null,
        restartCount: Number(service?.restartCount || 0),
        ok:
          service?.running === true &&
          service?.ready === true &&
          Number.isInteger(Number(service?.pid)) &&
          Number(service.pid) > 0
      };
    });

    const restartCount = requiredServices.reduce(
      (total, service) => total + service.restartCount,
      0
    );

    const ok =
      snapshot.ok === true &&
      snapshot.startupComplete === true &&
      snapshot.shuttingDown !== true &&
      services.length === REQUIRED_SERVICES.length &&
      requiredServices.every(service => service.ok);

    return {
      ok,
      status: ok ? "HEALTHY" : "DEGRADED",
      generatedAt: snapshot.generatedAt,
      ageMs: result.ageMs,
      serviceCount: services.length,
      requiredServiceCount: REQUIRED_SERVICES.length,
      readyCount: requiredServices.filter(service => service.ready).length,
      runningCount: requiredServices.filter(service => service.running).length,
      restartCount,
      services: requiredServices,
      evidence: result.filePath
    };
  }

  validateWorker(result) {
    if (!result.ok) return result;

    const snapshot = result.snapshot;
    const lifecycle = snapshot.lifecycle || {};
    const ok =
      snapshot.ok === true &&
      lifecycle.started === true &&
      lifecycle.shuttingDown !== true &&
      Number.isInteger(Number(snapshot.pid)) &&
      Number(snapshot.pid) > 0;

    return {
      ok,
      status: ok ? "HEALTHY" : "DEGRADED",
      pid: snapshot.pid || null,
      generatedAt: snapshot.generatedAt,
      ageMs: result.ageMs,
      lifecycle,
      evidence: result.filePath
    };
  }

  validateQueue(result) {
    if (!result.ok) return result;

    const queue = result.snapshot.queue;
    const fields = [
      "total",
      "queued",
      "running",
      "completed",
      "failed",
      "awaitingApproval",
      "other"
    ];

    const numeric =
      queue &&
      fields.every(field =>
        Number.isInteger(Number(queue[field])) && Number(queue[field]) >= 0
      );

    const classified = numeric
      ? fields
          .filter(field => field !== "total")
          .reduce((total, field) => total + Number(queue[field]), 0)
      : null;

    const ok = numeric && Number(queue.total) === classified;

    return {
      ok,
      status: ok ? "HEALTHY" : "DEGRADED",
      counts: queue || null,
      classified,
      generatedAt: result.snapshot.generatedAt,
      ageMs: result.ageMs,
      evidence: result.filePath
    };
  }

  validateProviders(result) {
    if (!result.ok) return result;

    const resolution = result.snapshot.resolutionHealth || {};
    const components = {
      providerRegistry: resolution.providerRegistry?.ok === true,
      capabilityRegistry: resolution.capabilityRegistry?.ok === true,
      connectorRegistry: resolution.connectorRegistry?.ok === true,
      routing: resolution.routing?.ok === true
    };

    const ok = resolution.ok === true && Object.values(components).every(Boolean);

    return {
      ok,
      status: ok ? "HEALTHY" : "DEGRADED",
      components,
      providerCount: resolution.providerRegistry?.validation?.providerCount ?? null,
      capabilityCount: resolution.capabilityRegistry?.capabilityCount ?? null,
      connectorCount: resolution.connectorRegistry?.connectorCount ?? null,
      checkedAt: resolution.checkedAt || null,
      generatedAt: result.snapshot.generatedAt,
      ageMs: result.ageMs,
      evidence: result.filePath
    };
  }

  async healthCheck() {
    const bootstrapSnapshot = this.readSnapshot(
      "productionBootstrap",
      this.bootstrapStatusFile
    );
    const workerSnapshot = this.readSnapshot(
      "workerRuntime",
      this.workerStatusFile
    );

    const snapshotProductionRuntime =
      this.validateProductionRuntime(bootstrapSnapshot);
    const liveProductionRuntime = this.livePm2Runtime();

    const productionRuntime = liveProductionRuntime.ok
      ? {
          ...liveProductionRuntime,
          snapshotStatus: snapshotProductionRuntime.status || null,
          snapshotEvidence:
            snapshotProductionRuntime.evidence ||
            bootstrapSnapshot.filePath ||
            null
        }
      : snapshotProductionRuntime;

    const components = {
      productionRuntime,
      workerRuntime: this.validateWorker(workerSnapshot),
      queue: this.validateQueue(workerSnapshot),
      providers: this.validateProviders(workerSnapshot)
    };

    const ok = Object.values(components).every(component => component.ok === true);

    return {
      ok,
      service: this.service,
      status: ok ? "HEALTHY" : "DEGRADED",
      components,
      generatedAt: new Date(this.now()).toISOString()
    };
  }
}

module.exports = ExecutiveRuntimeHealthService;
module.exports.ExecutiveRuntimeHealthService = ExecutiveRuntimeHealthService;
module.exports.REQUIRED_SERVICES = REQUIRED_SERVICES;
module.exports.REQUIRED_PM2_APPS = REQUIRED_PM2_APPS;
