"use strict";

const MarketingProvider = require("../PROVIDERS/providers/MarketingProvider");
const OrionProvider = require("../PROVIDERS/providers/OrionProvider");
const WebsiteProvider = require("../PROVIDERS/providers/WebsiteProvider");

class ProviderRouterService {
  constructor() {
    this.providers = {
      MarketingProvider,
      OrionProvider,
      WebsiteProvider
    };

    this.aliases = {
      marketing: "MarketingProvider",
      marketingprovider: "MarketingProvider",
      instantly: "MarketingProvider",
      instantlyprovider: "MarketingProvider",
      linkedin: "MarketingProvider",
      millionverifier: "MarketingProvider",

      website: "WebsiteProvider",
      websiteprovider: "WebsiteProvider",
      b12: "WebsiteProvider",
      websiteb12: "WebsiteProvider",

      orion: "OrionProvider",
      orionprovider: "OrionProvider",
      governmentdata: "OrionProvider",
      govdata: "OrionProvider",
      usaspending: "OrionProvider",
      gsa: "OrionProvider",
      gsaelibrary: "OrionProvider",
      vafss: "OrionProvider",
      sam: "OrionProvider",
      rfi: "OrionProvider",
      forecast: "OrionProvider",
      sourcessought: "OrionProvider"
    };
  }

  normalizeProviderName(providerName = "") {
    const raw = String(providerName || "").trim();
    if (!raw) return null;

    const key = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
    return this.aliases[key] || raw;
  }

  hasProvider(providerName = "") {
    const normalized = this.normalizeProviderName(providerName);
    return Boolean(normalized && this.providers[normalized]);
  }

  async invokeProvider(provider, action, task) {
    const normalizedAction = String(action || "").trim();

    if (
      normalizedAction &&
      typeof provider[normalizedAction] === "function"
    ) {
      return provider[normalizedAction](task);
    }

    if (typeof provider.executeTask === "function") {
      return provider.executeTask(task);
    }

    if (typeof provider.initialize === "function") {
      return provider.initialize(task);
    }

    if (typeof provider.refresh === "function") {
      return provider.refresh(task);
    }

    throw new Error(
      `Provider exposes no executable action: ${normalizedAction || "unspecified"}`
    );
  }

  async executeProviderTask(task = {}) {
    const payload = task.payload || task || {};
    const requestedProvider = payload.provider || null;
    const providerName = this.normalizeProviderName(requestedProvider);

    if (!providerName) {
      return this.noProviderResult(task, "No provider was specified for this task.");
    }

    const ProviderClass = this.providers[providerName];

    if (!ProviderClass) {
      return this.noProviderResult(
        task,
        `Provider is not registered: ${providerName}`
      );
    }

    const startedAt = new Date().toISOString();

    try {
      const provider = new ProviderClass();
      const requestedAction = payload.action || "refresh";
      const providerOutput = await this.invokeProvider(
        provider,
        requestedAction,
        task
      );
      const completedAt = new Date().toISOString();

      return {
        ok: provider.status !== "Critical",
        type: "PROVIDER_EXECUTION_RESULT",
        requestedProvider,
        provider: providerName,
        routedTo: providerName,
        action: requestedAction,
        actionInvoked:
          typeof provider[requestedAction] === "function"
            ? requestedAction
            : (
                typeof provider.executeTask === "function"
                  ? "executeTask"
                  : (
                      typeof provider.initialize === "function"
                        ? "initialize"
                        : "refresh"
                    )
              ),
        taskId: task.id || null,
        workPackageId: payload.workPackageId || null,
        objective: payload.objective || null,
        capability: payload.capability || null,
        assignedTo: payload.assignedTo || "MILES",
        department: payload.department || null,
        status: provider.status || "Unknown",
        dataFreshness: provider.dataFreshness || "Unknown",
        lastRefresh: provider.lastRefresh || completedAt,
        metrics: provider.metrics || {},
        exceptions: provider.exceptions || [],
        recommendations: provider.recommendations || [],
        providerOutput,
        evidence: {
          providerLoaded: true,
          initialized: true,
          requestedProvider,
          routedProvider: providerName,
          requestedAction,
          actionAvailable:
            typeof provider[requestedAction] === "function",
          metricsCaptured: Boolean(provider.metrics),
          exceptionsCaptured: Array.isArray(provider.exceptions),
          recommendationsCaptured: Array.isArray(provider.recommendations)
        },
        startedAt,
        completedAt
      };
    } catch (err) {
      return {
        ok: false,
        type: "PROVIDER_EXECUTION_RESULT",
        requestedProvider,
        provider: providerName,
        routedTo: providerName,
        action: payload.action || "refresh",
        taskId: task.id || null,
        workPackageId: payload.workPackageId || null,
        objective: payload.objective || null,
        capability: payload.capability || null,
        assignedTo: payload.assignedTo || "MILES",
        department: payload.department || null,
        status: "FAILED",
        metrics: {},
        exceptions: [{
          type: "ProviderRouter",
          severity: "Critical",
          message: err.stack || err.message
        }],
        recommendations: [
          `Verify provider action and connector configuration for ${providerName}.`
        ],
        evidence: {
          providerLoaded: true,
          initialized: false,
          requestedProvider,
          routedProvider: providerName,
          requestedAction: payload.action || null,
          error: err.stack || err.message
        },
        startedAt,
        completedAt: new Date().toISOString()
      };
    }
  }

  noProviderResult(task = {}, reason = "") {
    const payload = task.payload || task || {};

    return {
      ok: false,
      type: "NO_PROVIDER_RESULT",
      provider: payload.provider || null,
      action: payload.action || null,
      taskId: task.id || null,
      workPackageId: payload.workPackageId || null,
      objective: payload.objective || null,
      capability: payload.capability || null,
      assignedTo: payload.assignedTo || "MILES",
      department: payload.department || null,
      status: "NO_PROVIDER",
      metrics: {},
      exceptions: [{
        type: "ProviderRouting",
        severity: "Info",
        message: reason
      }],
      recommendations: [
        "Register this provider or route it to an existing operational provider."
      ],
      evidence: {
        providerLoaded: false,
        reason
      },
      completedAt: new Date().toISOString()
    };
  }

  status() {
    return {
      ok: true,
      registeredProviders: Object.keys(this.providers),
      aliases: this.aliases
    };
  }
}

module.exports = new ProviderRouterService();
