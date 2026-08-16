"use strict";

const connectorManager = require("./ConnectorManager");
const taskQueue = require("./TaskQueue");
const workforceService = require("../SERVICES/WorkforceService");
const { buildExecutiveState } = require("./STATE/ExecutiveState");

function lazyConnector(modulePath) {
  let implementation = null;

  function load() {
    if (!implementation) implementation = require(modulePath);
    return implementation;
  }

  return {
    healthCheck(...args) {
      const target = load();
      return typeof target.healthCheck === "function"
        ? target.healthCheck(...args)
        : { ok: true, status: "AVAILABLE" };
    },

    execute(...args) {
      const target = load();
      if (typeof target.execute !== "function") {
        throw new Error("Connector does not implement execute(): " + modulePath);
      }
      return target.execute(...args);
    }
  };
}

class Supervisor {
  constructor() {
    this.running = false;
    this.interval = null;
    this.lastState = null;
  }

  async registerConnectors() {
    const connectors = [
      ["INSTANTLY", "../CONNECTORS/INSTANTLY/connector"],
      ["ORION", "../CONNECTORS/ORION/connector"],
      ["MILES", "../CONNECTORS/MILES/connector"]
    ];

    for (const [name, connectorPath] of connectors) {
      try {
        if (!connectorManager.get(name)) {
          connectorManager.register(name, lazyConnector(connectorPath));
        }
      } catch (error) {
        console.warn("[Supervisor] " + name + " lazy registration failed: " + error.message);
      }
    }
  }

  async heartbeat() {
    try {
      const queue = taskQueue.getStatus();
      const workforceRaw = workforceService.status();
      const connectorNames = connectorManager.list();
      const connectors = {};

      for (const name of connectorNames) {
        connectors[name] = {
          name,
          ok: true,
          healthy: null,
          status: "REGISTERED_LAZY"
        };
      }

      const workforce = {
        ok: workforceRaw.ok !== false,
        workers: workforceRaw.employees || 0,
        employees: workforceRaw.employees || 0,
        capabilities: workforceRaw.capabilities || 0,
        active: 0,
        idle: workforceRaw.employees || 0,
        queued: queue.pending || 0,
        registryPath: workforceRaw.registryPath || null
      };

      const capabilities = {
        ok: workforce.ok,
        count: workforce.capabilities,
        available: []
      };

      const workflow = {
        ok: true,
        status: "ON_DEMAND"
      };

      const recovery = {
        total: queue.failed || 0,
        waiting: queue.failed || 0,
        retrying: 0,
        blocked: 0,
        byType: {}
      };

      this.lastState = buildExecutiveState({
        connectors,
        queue,
        workforce,
        capabilities,
        workflow,
        recovery
      });

      console.log(
        "[MILES] SUPERVISOR HEARTBEAT | health=" +
        this.lastState.health.overall +
        " connectors=" + connectorNames.length +
        " workers=" + workforce.workers +
        " pending=" + (queue.pending || 0) +
        " running=" + (queue.running || 0) +
        " failed=" + (queue.failed || 0)
      );

      return this.lastState;
    } catch (error) {
      console.error("[Supervisor] HEARTBEAT FAILED", error);
      return { ok: false, error: error.message };
    }
  }

  async start(intervalMs = 60000) {
    if (this.running) return;

    this.running = true;
    console.log("[MILES] Minimal supervisor starting");

    await this.registerConnectors();
    await this.heartbeat();

    this.interval = setInterval(() => {
      this.heartbeat().catch(error =>
        console.error("[Supervisor] HEARTBEAT FAILED", error)
      );
    }, intervalMs);
  }

  stop() {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    this.running = false;
    console.log("[MILES] Minimal supervisor stopped");
  }
}

module.exports = new Supervisor();
