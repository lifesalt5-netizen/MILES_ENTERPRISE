"use strict";

class ServiceRegistry {

    constructor() {

        this.services = new Map();

    }

    // =====================================================
    // REGISTER
    // =====================================================

    register(name, service, options = {}) {

        const id = String(name);

        const existing =
            this.services.get(id);

        const record = {

            id,

            service,

            version:
                options.version || "1.0.0",

            type:
                options.type || "GENERAL",

            owner:
                options.owner || "MILES",

            path:
                options.path || null,

            capabilities:
                Array.isArray(options.capabilities)
                    ? options.capabilities
                    : [],

            dependencies:
                Array.isArray(options.dependencies)
                    ? options.dependencies
                    : [],

            status:
                options.status || "REGISTERED",

            startedAt:
                existing?.startedAt ||
                new Date().toISOString(),

            heartbeat:
                new Date().toISOString(),

            restartCount:
                existing?.restartCount || 0,

            lastError:
                null

        };

        this.services.set(id, record);

        console.log(`[Registry] ${id} registered.`);

        return record;

    }

    // =====================================================
    // GETTERS
    // =====================================================

    get(name) {

        return this.services.get(String(name))?.service;

    }

    getRecord(name) {

        return this.services.get(String(name));

    }

    exists(name) {

        return this.services.has(String(name));

    }

    list() {

        return Array.from(this.services.keys());

    }

    // =====================================================
    // STATUS
    // =====================================================

    updateStatus(name, status) {

        const record =
            this.services.get(String(name));

        if (!record)
            return false;

        record.status = status;

        record.heartbeat =
            new Date().toISOString();

        return true;

    }

    heartbeat(name) {

        const record =
            this.services.get(String(name));

        if (!record)
            return false;

        record.heartbeat =
            new Date().toISOString();

        return true;

    }

    recordError(name, error) {

        const record =
            this.services.get(String(name));

        if (!record)
            return false;

        record.status = "ERROR";

        record.lastError =
            String(error);

        record.heartbeat =
            new Date().toISOString();

        return true;

    }

    restart(name) {

        const record =
            this.services.get(String(name));

        if (!record)
            return false;

        record.restartCount++;

        record.status =
            "RESTARTED";

        record.heartbeat =
            new Date().toISOString();

        return true;

    }

    // =====================================================
    // REPORTS
    // =====================================================

    health() {

        return Array.from(
            this.services.values()
        ).map(service => ({

            service:
                service.id,

            status:
                service.status,

            heartbeat:
                service.heartbeat,

            startedAt:
                service.startedAt

        }));

    }

    summary() {

        const services =
            Array.from(
                this.services.values()
            );

        return {

            generatedAt:
                new Date().toISOString(),

            totalServices:
                services.length,

            healthy:
                services.filter(
                    s =>
                        s.status === "HEALTHY" ||
                        s.status === "REGISTERED"
                ).length,

            warning:
                services.filter(
                    s =>
                        s.status === "WARNING"
                ).length,

            error:
                services.filter(
                    s =>
                        s.status === "ERROR"
                ).length,

            restarting:
                services.filter(
                    s =>
                        s.status === "RESTARTED"
                ).length,

            services

        };

    }

    capabilities() {

        return Array.from(
            this.services.values()
        ).map(service => ({

            service:
                service.id,

            capabilities:
                service.capabilities

        }));

    }

    dependencies() {

        return Array.from(
            this.services.values()
        ).map(service => ({

            service:
                service.id,

            dependencies:
                service.dependencies

        }));

    }

}

module.exports =
    new ServiceRegistry();