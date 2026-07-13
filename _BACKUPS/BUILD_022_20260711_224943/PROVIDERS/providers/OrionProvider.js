"use strict";

const IDataProvider = require("../contracts/IDataProvider");
const orion = require("../../CONNECTORS/ORION/connector");

class OrionProvider extends IDataProvider {

    constructor() {

        super("ORION");

        this.dependencies = [
            "ORION Database"
        ];

        this.sourceSystems = [
            "CONNECTORS/ORION"
        ];

        this.contractors = [];
        this.buyers = [];
        this.opportunities = [];
        this.recompetes = [];
        this.recommendationRecords = [];
        this.personaRecords = [];

    }

    async initialize() {

        this.status = "Initializing";

        await this.refresh();

        return true;

    }

    async refresh() {

        this.lastRefresh = new Date().toISOString();
        this.dataFreshness = "Live";

        try {

            const summary = orion.getSummary();

            this.status =
                summary.health.ok
                    ? "Healthy"
                    : "Critical";

            //
            // Load business objects
            //

            this.contractors =
                orion.getContractors(100);

            this.buyers =
                orion.getBuyers(100);

            this.opportunities =
                orion.getOpportunities(100);

            this.recompetes =
                orion.getRecompetes(100);

            this.recommendationRecords =
                orion.getRecommendations(100);

            this.personaRecords =
                orion.getPersonas(100);

            //
            // Metrics
            //

            this.metrics = {

                database: summary.health.db,

                tableCount: summary.health.tableCount,

                contractors: summary.contractors.count,

                buyers: summary.buyers.count,

                opportunities: summary.opportunities.count,

                recompetes: summary.recompetes.count,

                recommendations: summary.recommendations.count,

                personas: summary.personas.count

            };

            this.exceptions = [];

            if (!summary.health.ok) {

                this.exceptions.push({

                    type: "Database",

                    severity: "Critical",

                    message: "ORION database unavailable."

                });

            }

            this.recommendations = [];

            if (summary.opportunities.count === 0) {

                this.recommendations.push(
                    "No opportunities detected. Verify ingestion pipeline."
                );

            }

        }

        catch (err) {

            this.status = "Critical";

            this.metrics = {};

            this.contractors = [];
            this.buyers = [];
            this.opportunities = [];
            this.recompetes = [];
            this.recommendationRecords = [];
            this.personaRecords = [];

            this.exceptions = [

                {

                    type: "ORION",

                    severity: "Critical",

                    message: err.message

                }

            ];

            this.recommendations = [

                "Verify ORION connector.",
                "Verify ORION database."

            ];

        }

    }

    getProviderState() {

        return {

            provider: this.name,

            status: this.status,

            lastRefresh: this.lastRefresh,

            dataFreshness: this.dataFreshness,

            metrics: this.metrics,

            exceptions: this.exceptions,

            recommendations: this.recommendations,

            //
            // Business objects consumed by
            // BusinessStateAggregator
            //

            contractors: this.contractors,

            buyers: this.buyers,

            opportunities: this.opportunities,

            recompetes: this.recompetes,

            recommendationRecords: this.recommendationRecords,

            personaRecords: this.personaRecords,

            //
            // Revenue Engine compatibility
            //

            leads: this.contractors,

            deals: [],

            replies: [],

            campaigns: [],

            proposals: []

        };

    }

    async shutdown() {

        return true;

    }

}

module.exports = OrionProvider;