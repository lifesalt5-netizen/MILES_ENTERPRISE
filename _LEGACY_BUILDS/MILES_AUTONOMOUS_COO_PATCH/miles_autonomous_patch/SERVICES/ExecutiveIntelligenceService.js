"use strict";

function now() {
  return new Date().toISOString();
}

function safeProviderState(name, err) {
  return {
    provider: name,
    status: "Critical",
    lastRefresh: now(),
    dataFreshness: "Unavailable",
    metrics: {},
    exceptions: [
      {
        type: `${name}ProviderLoadFailure`,
        severity: "Critical",
        provider: name,
        message: err.stack || err.message || String(err)
      }
    ],
    recommendations: [
      `Verify ${name} provider dependencies and connector configuration.`,
      "Keep MILES running in degraded mode and queue repair work instead of crashing the COO cycle."
    ],
    dependencies: [],
    sourceSystems: []
  };
}

class ExecutiveIntelligenceService {
  constructor() {
    this.providerFactories = [
      {
        name: "Marketing",
        load: () => {
          const MarketingProvider = require("../PROVIDERS/providers/MarketingProvider");
          return new MarketingProvider();
        }
      },
      {
        name: "ORION",
        load: () => {
          const OrionProvider = require("../PROVIDERS/providers/OrionProvider");
          return new OrionProvider();
        }
      }
    ];

    this.providerStates = [];
  }

  async refresh() {
    const states = [];

    for (const factory of this.providerFactories) {
      try {
        const provider = factory.load();

        if (typeof provider.initialize === "function") {
          await provider.initialize();
        } else if (typeof provider.refresh === "function") {
          await provider.refresh();
        }

        states.push(provider.getProviderState());
      } catch (err) {
        states.push(safeProviderState(factory.name, err));
      }
    }

    this.providerStates = states;
    return true;
  }

  getExecutiveState() {
    const providerStates = this.providerStates || [];

    const marketing =
      providerStates.find(p => p.provider === "Marketing") || {};

    const orion =
      providerStates.find(p => p.provider === "ORION") || {};

    const businessHealth =
      providerStates.every(p => p.status === "Healthy")
        ? "Healthy"
        : providerStates.some(p => p.status === "Critical")
          ? "Critical"
          : "Watch";

    const exceptions =
      providerStates.flatMap(p => p.exceptions || []);

    const recommendations =
      providerStates.flatMap(p => p.recommendations || []);

    return {
      generatedAt: now(),
      businessHealth,
      executiveSummary: {
        totalProviders: providerStates.length,
        healthyProviders: providerStates.filter(p => p.status === "Healthy").length,
        criticalProviders: providerStates.filter(p => p.status === "Critical").length
      },
      marketing: marketing.metrics || {},
      orion: orion.metrics || {},
      exceptions,
      recommendations,
      providers: providerStates
    };
  }
}

module.exports = ExecutiveIntelligenceService;
