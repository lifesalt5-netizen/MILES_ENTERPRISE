const connectorManager = require("./ConnectorManager");
const taskQueue = require("./TaskQueue");

const workforceService = require("../SERVICES/WorkforceService");
const capabilityService = require("../SERVICES/CapabilityService");
const workflowService = require("../SERVICES/WorkflowService");

const { buildExecutiveState } = require("./STATE/ExecutiveState");
const { classifyFailedTasks } = require("./RECOVERY/RecoveryEngine");

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
                    connectorManager.register(name, require(connectorPath));
                }
            } catch (err) {
                console.warn(`[Supervisor] ${name} connector registration failed: ${err.message}`);
            }
        }
    }

    async heartbeat() {
        try {
            const connectorResults = await connectorManager.healthCheckAll();

            const connectors = {};
            for (const c of connectorResults) {
                connectors[c.name] = c;
            }

            const queue = taskQueue.getStatus();

            const workforceRaw = workforceService.status();

            const workforce = {
                ok: workforceRaw.ok,
                workers: workforceRaw.employees || 0,
                employees: workforceRaw.employees || 0,
                capabilities: workforceRaw.capabilities || 0,
                active: 0,
                idle: workforceRaw.employees || 0,
                queued: queue.pending,
                registryPath: workforceRaw.registryPath
            };

            let capabilities = {};
            try {
                const capGraph = capabilityService.buildGraph();
                capabilities = {
                    ok: capGraph.ok,
                    count: capGraph.capabilities,
                    available: Object.keys(capGraph.graph || {}).slice(0, 50)
                };
            } catch (err) {
                capabilities = {
                    ok: false,
                    error: err.message
                };
            }

            let workflow = {};
            try {
                workflow = workflowService.status();
            } catch (err) {
                workflow = {
                    ok: false,
                    error: err.message
                };
            }

            const failedTasks = taskQueue.list("FAILED");
            const recovery = classifyFailedTasks(failedTasks);

            this.lastState = buildExecutiveState({
                connectors,
                queue,
                workforce,
                capabilities,
                workflow,
                recovery: {
                    total: recovery.total,
                    waiting: recovery.total,
                    retrying: 0,
                    blocked: 0,
                    byType: recovery.byType || {}
                }
            });

            console.log("");
            console.log("========== MILES HEARTBEAT ==========");
            console.log("Health      :", this.lastState.health.overall);
            console.log("Connectors  :", Object.keys(connectors).length);
            console.log("Workers     :", workforce.workers);
            console.log("Capabilities:", workforce.capabilities);
            console.log("Pending     :", queue.pending);
            console.log("Running     :", queue.running);
            console.log("Completed   :", queue.completed);
            console.log("Failed      :", queue.failed);
            console.log("Recovery    :", recovery.total);
            console.log("Heartbeat   :", new Date().toLocaleTimeString());
            console.log("=====================================");
        } catch (err) {
            console.error("");
            console.error("[Supervisor] HEARTBEAT FAILED");
            console.error(err);
        }
    }

    async start(intervalMs = 60000) {
        if (this.running) {
            console.log("Supervisor already running.");
            return;
        }

        this.running = true;

        console.log("");
        console.log("==================================");
        console.log("MILES SUPERVISOR STARTING");
        console.log("==================================");

        await this.registerConnectors();
        await this.heartbeat();

        this.interval = setInterval(async () => {
            await this.heartbeat();
        }, intervalMs);
    }

    stop() {
        if (this.interval) {
            clearInterval(this.interval);
        }

        this.running = false;

        console.log("");
        console.log("Supervisor stopped.");
    }
}

module.exports = new Supervisor();