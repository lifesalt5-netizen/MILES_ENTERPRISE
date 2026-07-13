const registry = require("./ServiceRegistry");
const healthMonitor = require("./HealthMonitor");
const eventBus = require("./EventBus");
const memory = require("../../SERVICES/MemoryService");

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

        console.log("");
        console.log("System Services");
        console.log("---------------");

        registry.health().forEach(service => {
            console.log(`${service.service.padEnd(18)} OK`);
        });

        console.log("");
        console.log("Business Systems");
        console.log("----------------");
        console.log("ORION              Waiting");
        console.log("Instantly          Waiting");
        console.log("Website            Waiting");
        console.log("Google Workspace   Waiting");
        console.log("Namecheap          Waiting");

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
    }
}

module.exports = new MilesKernel();