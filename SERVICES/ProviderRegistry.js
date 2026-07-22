"use strict";

/**
 * ==========================================================
 * MILES Enterprise
 * BUILD 131
 * ProviderRegistry.js
 * ----------------------------------------------------------
 * Single source of truth for all execution providers.
 * ==========================================================
 */

class ProviderRegistry {

    constructor() {

        this.providers = new Map();

        this.registerDefaults();

    }

    register(provider) {

        if (!provider || !provider.id) {
            throw new Error("Provider must contain an id.");
        }

        const id = String(provider.id).toUpperCase();

        this.providers.set(id, {

            enabled: true,
            requiresKevinApproval: false,
            health: "HEALTHY",
            capabilities: [],
            actions: [],

            ...provider,

            id

        });

        return this.providers.get(id);

    }

    unregister(id) {

        this.providers.delete(String(id).toUpperCase());

    }

    get(id) {

        return this.providers.get(String(id).toUpperCase()) || null;

    }

    has(id) {

        return this.providers.has(String(id).toUpperCase());

    }

    list() {

        return [...this.providers.values()]
            .sort((a, b) => a.id.localeCompare(b.id));

    }

    isEnabled(id) {

        const provider = this.get(id);

        return provider ? provider.enabled !== false : false;

    }

    getConnector(id) {

        const provider = this.get(id);

        return provider
            ? provider.connector
            : null;

    }

    getCapabilities(id) {

        const provider = this.get(id);

        return provider
            ? provider.capabilities || []
            : [];

    }

    canExecute(id, action) {

        const provider = this.get(id);

        if (!provider) return false;

        if (!provider.enabled) return false;

        if (!action) return true;

        if (!provider.actions.length)
            return true;

        return provider.actions.includes(action);

    }

    resolve(operation = {}) {

        if (operation.provider && this.has(operation.provider)) {
            return this.get(operation.provider);
        }

        if (operation.connector && this.has(operation.connector)) {
            return this.get(operation.connector);
        }

        if (operation.system && this.has(operation.system)) {
            return this.get(operation.system);
        }

        const text = [

            operation.title,
            operation.command,
            operation.objective,
            operation.reason,
            operation.action

        ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();

        if (/instantly|campaign|outbound|email/.test(text))
            return this.get("INSTANTLY");

        if (/orion|opportunity|contractor|buyer|recompete/.test(text))
            return this.get("ORION");

        if (/calendar/.test(text))
            return this.get("GOOGLE_CALENDAR");

        if (/gmail/.test(text))
            return this.get("GMAIL");

        if (/google/.test(text))
            return this.get("GOOGLE");

        if (/linkedin/.test(text))
            return this.get("LINKEDIN");

        if (/website|b12/.test(text))
            return this.get("WEBSITE");

        if (/dreamers/.test(text))
            return this.get("DREAMERS");

        if (/sales|crm|proposal|pipeline/.test(text))
            return this.get("SALES");

        return this.get("MILES");

    }

    registerDefaults() {

        this.register({
            id: "MILES",
            department: "Executive",
            connector: "MILES",
            capabilities: ["AUTONOMY"]
        });

        this.register({
            id: "ORION",
            department: "Intelligence",
            connector: "ORION",
            capabilities: ["CONTRACTOR_INTELLIGENCE"]
        });

        this.register({
            id: "INSTANTLY",
            department: "Sales",
            connector: "INSTANTLY",
            adapterModule: "SERVICES/InstantlyEnterpriseAdapterService.js",
            providerModule: "PROVIDERS/providers/InstantlyProvider.js",
            capabilities: [
                "OUTBOUND_EMAIL",
                "CAMPAIGN_INVENTORY",
                "CAMPAIGN_METRICS",
                "CAMPAIGN_EXCEPTIONS",
                "CAMPAIGN_RECOMMENDATIONS"
            ],
            actions: [
                "INSTANTLY_REFRESH",
                "INSTANTLY_LIST_CAMPAIGNS",
                "INSTANTLY_GET_CAMPAIGN",
                "INSTANTLY_GET_ACTIVE_CAMPAIGNS"
            ]
        });

        this.register({
            id: "GOOGLE",
            department: "Operations",
            connector: "GOOGLE",
            capabilities: ["WORKSPACE"]
        });

        this.register({
            id: "GMAIL",
            department: "Operations",
            connector: "GOOGLE",
            capabilities: ["EMAIL"]
        });

        this.register({
            id: "GOOGLE_CALENDAR",
            department: "Operations",
            connector: "GOOGLE",
            capabilities: ["CALENDAR"]
        });

        this.register({
            id: "NAMECHEAP",
            department: "Infrastructure",
            connector: "NAMECHEAP",
            capabilities: ["DOMAINS"]
        });

        this.register({
            id: "B12",
            department: "Marketing",
            connector: "B12",
            capabilities: ["WEBSITE"]
        });

        this.register({
            id: "LINKEDIN",
            department: "Marketing",
            connector: "LINKEDIN",
            capabilities: ["SOCIAL"]
        });

        this.register({
            id: "WEBSITE",
            department: "Marketing",
            connector: "WEBSITE",
            capabilities: ["WEB"]
        });

        this.register({
            id: "MARKETING",
            department: "Marketing",
            connector: "MARKETING"
        });

        this.register({
            id: "SALES",
            department: "Sales",
            connector: "CRM"
        });

        this.register({
            id: "DREAMERS",
            department: "Client Delivery",
            connector: "DREAMERS"
        });

        this.register({
            id: "EXECUTIVE",
            department: "Executive",
            connector: "MILES"
        });

    }

}

module.exports = new ProviderRegistry();