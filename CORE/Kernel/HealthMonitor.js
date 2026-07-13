const registry = require("./ServiceRegistry");
const eventBus = require("./EventBus");

class HealthMonitor {
    constructor() {
        this.interval = null;
        this.lastSnapshot = [];
    }

    start() {
        console.log("[HealthMonitor] started.");

        this.check();

        this.interval = setInterval(() => {
            this.check();
        }, 30000);
    }

    check() {
        this.lastSnapshot = registry.health();

        eventBus.emitEvent("health.checked", {
            services: this.lastSnapshot
        });

        return this.lastSnapshot;
    }

    getSnapshot() {
        return this.lastSnapshot;
    }

    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }

        console.log("[HealthMonitor] stopped.");
    }
}

module.exports = new HealthMonitor();