/**
 * MILES IDataProvider
 *
 * Standard contract for every operational data provider.
 *
 * Every provider MUST return:
 *  - status
 *  - metrics
 *  - exceptions
 *  - recommendations
 *  - freshness
 *
 * No provider should throw fatal errors.
 * Always degrade gracefully.
 */

class IDataProvider {
    constructor(name) {
        if (!name) {
            throw new Error("Provider requires a name.");
        }

        this.name = name;

        this.status = "Unknown";

        this.metrics = {};

        this.exceptions = [];

        this.recommendations = [];

        this.lastRefresh = null;

        this.dataFreshness = "Never";

        this.dependencies = [];

        this.sourceSystems = [];
    }

    async initialize() {
        return true;
    }

    async refresh() {
        throw new Error(
            `${this.name}: refresh() not implemented.`
        );
    }

    getStatus() {
        return {
            provider: this.name,
            status: this.status,
            lastRefresh: this.lastRefresh,
            dataFreshness: this.dataFreshness
        };
    }

    getMetrics() {
        return this.metrics;
    }

    getExceptions() {
        return this.exceptions;
    }

    getRecommendations() {
        return this.recommendations;
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
            dependencies: this.dependencies,
            sourceSystems: this.sourceSystems
        };
    }

    async shutdown() {
        return true;
    }
}

module.exports = IDataProvider;