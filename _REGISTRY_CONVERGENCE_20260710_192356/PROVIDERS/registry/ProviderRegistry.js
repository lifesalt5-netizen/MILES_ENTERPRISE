class ProviderRegistry {
    constructor() {
        this.providers = new Map();
    }

    register(provider) {
        if (!provider || !provider.name) {
            throw new Error("Cannot register provider without a valid name.");
        }

        this.providers.set(provider.name, provider);

        console.log(`[ProviderRegistry] Registered: ${provider.name}`);
    }

    unregister(name) {
        this.providers.delete(name);
    }

    get(name) {
        return this.providers.get(name);
    }

    getAll() {
        return [...this.providers.values()];
    }

    async initializeAll() {
        for (const provider of this.providers.values()) {
            if (typeof provider.initialize === "function") {
                await provider.initialize();
            }
        }
    }

    async refreshAll() {
        for (const provider of this.providers.values()) {
            try {
                await provider.refresh();
            } catch (err) {
                console.error(
                    `[ProviderRegistry] ${provider.name} refresh failed`,
                    err
                );

                provider.status = "Critical";
                provider.exceptions.push({
                    type: "ProviderFailure",
                    message: err.message,
                    timestamp: new Date().toISOString()
                });
            }
        }
    }

    getHealthSummary() {
        return this.getAll().map(provider => provider.getStatus());
    }

    getMetrics() {
        const metrics = {};

        for (const provider of this.providers.values()) {
            metrics[provider.name] = provider.getMetrics();
        }

        return metrics;
    }

    getExceptions() {
        const exceptions = [];

        for (const provider of this.providers.values()) {
            exceptions.push(...provider.getExceptions());
        }

        return exceptions;
    }

    getRecommendations() {
        const recommendations = [];

        for (const provider of this.providers.values()) {
            recommendations.push(...provider.getRecommendations());
        }

        return recommendations;
    }
}

module.exports = ProviderRegistry;