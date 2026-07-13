class ServiceRegistry {
    constructor() {
        this.services = new Map();
    }

    register(name, service) {
        this.services.set(name, {
            service,
            status: "registered",
            startedAt: new Date().toISOString()
        });

        console.log(`[Registry] ${name} registered.`);
    }

    get(name) {
        return this.services.get(name)?.service;
    }

    exists(name) {
        return this.services.has(name);
    }

    list() {
        return Array.from(this.services.keys());
    }

    health() {
        return Array.from(this.services.entries()).map(([name, value]) => ({
            service: name,
            status: value.status,
            startedAt: value.startedAt
        }));
    }
}

module.exports = new ServiceRegistry();