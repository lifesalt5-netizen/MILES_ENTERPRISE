"use strict";

const fs = require("fs");
const path = require("path");

const BusinessStateAggregator =
    require("./BusinessStateAggregator");

const ROOT = process.cwd();

function now() {
    return new Date().toISOString();
}

function safe(file) {
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
        return {};
    }
}

function readLatest(dir) {
    try {

        if (!fs.existsSync(dir))
            return [];

        return fs.readdirSync(dir)
            .filter(f => f.endsWith(".json"))
            .map(f => safe(path.join(dir, f)));

    } catch {

        return [];

    }
}

class ExecutiveIntelligenceService {

    constructor() {

        this.providerFactories = [

    {
        name: "Website",
        load: () =>
            require("../PROVIDERS/providers/WebsiteProvider")
    },

    {
        name: "ORION",
        load: () =>
            require("../PROVIDERS/providers/OrionProvider")
    },

    {
        name: "Instantly",
        load: () =>
            require("../PROVIDERS/providers/InstantlyProvider")
    }

    /*
    Future Providers

    ,
    {
        name: "CRM",
        load: () => require("../PROVIDERS/providers/CRMProvider")
    },

    {
        name: "Google",
        load: () => require("../PROVIDERS/providers/GoogleProvider")
    }
    */

];

    

        this.providerStates = [];

    }

    // ======================================================
    // REFRESH ALL PROVIDERS
    // ======================================================

    async refresh() {

        const states = [];

        for (const factory of this.providerFactories) {

            try {

                const Provider = factory.load();

                const provider = new Provider();

                if (provider.initialize)
                    await provider.initialize();

                else if (provider.refresh)
                    await provider.refresh();

                const state =
                    provider.getProviderState?.() || {

                        provider: factory.name,
                        status: "Unknown",
                        metrics: {},
                        exceptions: [],

                        leads: [],
                        opportunities: [],
                        deals: [],
                        replies: [],
                        campaigns: [],
                        proposals: [],
                        contractors: []

                    };

                states.push(state);

            }

            catch (err) {

                states.push({

                    provider: factory.name,

                    status: "Critical",

                    metrics: {},

                    exceptions: [

                        {
                            message: err.message
                        }

                    ],

                    leads: [],
                    opportunities: [],
                    deals: [],
                    replies: [],
                    campaigns: [],
                    proposals: [],
                    contractors: []

                });

            }

        }

        this.providerStates = states;

        return true;

    }

    // ======================================================
    // EXECUTIVE STATE
    // ======================================================

    async getExecutiveState() {

        const providers = this.providerStates || [];

        const aggregator =
            new BusinessStateAggregator(providers);

        const business =
            await aggregator.build();

        const health = providers.map(p => ({

            provider: p.provider,

            status: p.status

        }));

        const score =
            providers.length
                ? providers.reduce(

                    (total, provider) =>

                        total +
                        (
                            provider.status === "Healthy"
                                ? 100
                                : provider.status === "Watch"
                                    ? 70
                                    : 25
                        ),

                    0

                ) / providers.length

                : 50;

        return {

            generatedAt: now(),

            providers,

            business,

            healthScore: Math.round(score),

            summary: {

                totalProviders: providers.length,

                healthy:
                    providers.filter(
                        p => p.status === "Healthy"
                    ).length,

                watch:
                    providers.filter(
                        p => p.status === "Watch"
                    ).length,

                critical:
                    providers.filter(
                        p => p.status === "Critical"
                    ).length

            }

        };

    }

}

module.exports = ExecutiveIntelligenceService;