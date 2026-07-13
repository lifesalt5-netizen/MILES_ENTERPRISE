"use strict";

const fs = require("fs");

const ConfigService = require("./ConfigService");

class CapabilityRegistry {

    constructor() {
        this.file =
            ConfigService.getRuntimePath("capability_registry.json");
    }

    load() {

        if (!fs.existsSync(this.file))
            return {};

        return JSON.parse(
            fs.readFileSync(this.file, "utf8")
        );

    }

    getAll() {

        return this.load();

    }

    getService(name) {

        const registry = this.load();

        return registry[name] || null;

    }

    getCapabilities(name) {

        const service = this.getService(name);

        if (!service)
            return [];

        return service.capabilities || [];

    }

    findByCapability(capability) {

        const registry = this.load();

        const matches = [];

        for (const serviceName of Object.keys(registry)) {

            const service = registry[serviceName];

            if (
                service.capabilities &&
                service.capabilities.includes(capability)
            ) {

                matches.push({
                    service: serviceName,
                    status: service.status,
                    version: service.version || null
                });

            }

        }

        return matches;

    }

}

module.exports = new CapabilityRegistry();