const fs = require("fs");
const path = require("path");
const connectorManager = require("../ConnectorManager");
const executionService = require("../../SERVICES/ExecutionService");
const registry = require("./ServiceRegistry");
const healthMonitor = require("./HealthMonitor");
const eventBus = require("./EventBus");
const memory = require("../../SERVICES/MemoryService");
const scheduler = require("../../SERVICES/SchedulerService");
const dashboard = require("../../SERVICES/DashboardService");

class MilesKernel {
    start() {
        console.clear();

        console.log("==================================================");
        console.log("                 MILES OS v1.0");
        console.log("              Digital COO Online");
        console.log("==================================================");
        console.log("");

        registry.register("EventBus", eventBus);
        registry.register("Memory", memory);
        registry.register("HealthMonitor", healthMonitor);
        registry.register("ExecutionService", executionService);
        registry.register("Scheduler", scheduler);
        registry.register("Dashboard", dashboard);
        // ------------------------------------
// Auto-discover business connectors
// ------------------------------------

const connectorRoot = path.join(__dirname, "..", "..", "CONNECTORS");

if (fs.existsSync(connectorRoot)) {

    for (const folder of fs.readdirSync(connectorRoot)) {

        const connectorFile = path.join(
            connectorRoot,
            folder,
            "connector.js"
        );

        if (!fs.existsSync(connectorFile))
            continue;

        try {

            const connector = require(connectorFile);

            connectorManager.register(
                folder.toUpperCase(),
                connector
            );

        } catch (err) {

            console.log(
                `[Connector] Failed to load ${folder}: ${err.message}`
            );

        }

    }

}

        console.log("");
        console.log("System Services");
        console.log("---------------");

        registry.health().forEach(service => {
            console.log(`${service.service.padEnd(18)} OK`);
        });

        console.log("");
console.log("Business Systems");
console.log("----------------");

const connectors = connectorManager.list();

if (!connectors.length) {

    console.log("No connectors registered.");

} else {

    connectors.forEach(name => {
        console.log(`${name.padEnd(18)} ONLINE`);
    });

}

        console.log("");
        console.log("Today's Priorities");
        console.log("------------------");
        console.log("1. ORION Demo");
        console.log("2. Revenue Generation");
        console.log("3. Dreamers Pursuits");
        console.log("4. Outbound Campaigns");
        console.log("5. Website Improvements");

        console.log("");
        console.log("Awaiting orders...");
        console.log("");

        eventBus.emitEvent("kernel.started", {
            services: registry.health()
        });

        scheduler.start();
        dashboard.render();
    }
}

module.exports = new MilesKernel();