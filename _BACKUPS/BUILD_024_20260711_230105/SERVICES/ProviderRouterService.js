"use strict";

const MarketingProvider =
  require("../PROVIDERS/providers/MarketingProvider");
const OrionProvider =
  require("../PROVIDERS/providers/OrionProvider");
const WebsiteProvider =
  require("../PROVIDERS/providers/WebsiteProvider");
const SalesProvider =
  require("../PROVIDERS/providers/SalesProvider");

const providerAuthority =
  require("./ProviderAuthorityRegistryService");
const providerBindings =
  require("./ProviderCapabilityBindingService");

function safeRun(service, input = {}) {
  try {
    return service.run(input);
  } catch (err) {
    return {
      ok: false,
      error: err.message
    };
  }
}

class ProviderRouterService {
  constructor() {
    this.providers = {
      MarketingProvider,
      OrionProvider,
      WebsiteProvider,
      SalesProvider
    };

    this.aliases = {
      marketing: "MarketingProvider",
      marketingprovider: "MarketingProvider",
      instantly: "MarketingProvider",
      instantlyprovider: "MarketingProvider",
      linkedin: "MarketingProvider",
      millionverifier: "MarketingProvider",

      sales: "SalesProvider",
      salesprovider: "SalesProvider",
      crm: "SalesProvider",
      pipeline: "SalesProvider",
      replies: "SalesProvider",
      proposals: "SalesProvider",

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

    this.providerKeys = {
      MarketingProvider: "instantly",
      WebsiteProvider: "website",
      OrionProvider: "orion",
      SalesProvider: "crm"
    };

    this.actionOperations = {
      MarketingProvider: {
        refresh: "LIST_CAMPAIGNS",
        initialize: "HEALTH_CHECK"
      },
      WebsiteProvider: {
        verifyWebsite: "HEALTH_CHECK",
        refresh: "HEALTH_CHECK",
        initialize: "HEALTH_CHECK"
      },
      OrionProvider: {
        refresh: "VERIFY_DATABASE",
        initialize: "HEALTH_CHECK"
      },
      SalesProvider: {
        processReplies: "READ_PIPELINE",
        reviewPipeline: "READ_PIPELINE",
        reviewProposals: "READ_PIPELINE",
        refresh: "READ_PIPELINE",
        initialize: "READ_PIPELINE"
      }
    };
  }

  normalizeProviderName(providerName = "") {
    const raw = String(providerName || "").trim();
    if (!raw) return null;

    const aliasKey = raw
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");

    return this.aliases[aliasKey] || raw;
  }

  hasProvider(providerName = "") {
    const normalized = this.normalizeProviderName(providerName);
    return Boolean(normalized && this.providers[normalized]);
  }

  authorityFor(providerName, action) {
    const providerKey = this.providerKeys[providerName] || null;
    const operation =
      this.actionOperations[providerName]?.[action] || null;

    const authorityRegistry = safeRun(providerAuthority);
    const bindingRegistry = safeRun(providerBindings);

    const authority = (authorityRegistry.providers || [])
      .find(provider => provider.key === providerKey) || null;

    const binding =
      bindingRegistry.bindings?.[providerKey] || null;

    const operationBinding = operation
      ? binding?.operations?.[operation] || null
      : null;

    return {
      providerKey,
      operation,
      authority,
      binding,
      operationBinding,
      registryAvailable: Boolean(
        authorityRegistry.ok &&
        bindingRegistry.ok
      )
    };
  }

  credentialRecommendations(authority) {
    const missing =
      authority?.authority?.credentials?.missingEnv || [];

    if (!missing.length) return [];

    return [
      `Provider is operating in safe/read-only mode. Configure missing environment variable(s): ${missing.join(", ")}.`,
      "Do not enable write operations until credentials, rollback, and governance controls are verified."
    ];
  }

  credentialExceptions(authority) {
    const missing =
      authority?.authority?.credentials?.missingEnv || [];

    if (!missing.length) return [];

    return [{
      type: "ProviderCredentials",
      severity: "Info",
      message:
        `Missing environment variable(s): ${missing.join(", ")}. Read-only authorized operations may continue.`
    }];
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
    const providerName =
      this.normalizeProviderName(requestedProvider);

    if (!providerName) {
      return this.noProviderResult(
        task,
        "No provider was specified for this task."
      );
    }

    const ProviderClass = this.providers[providerName];

    if (!ProviderClass) {
      return this.noProviderResult(
        task,
        `Provider is not registered: ${providerName}`
      );
    }

    const requestedAction = payload.action || "refresh";
    const authority =
      this.authorityFor(providerName, requestedAction);

    const startedAt = new Date().toISOString();

    try {
      const provider = new ProviderClass();
      const providerOutput = await this.invokeProvider(
        provider,
        requestedAction,
        task
      );

      const completedAt = new Date().toISOString();

      const credentialExceptions =
        this.credentialExceptions(authority);

      const credentialRecommendations =
        this.credentialRecommendations(authority);

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
        dataFreshness:
          provider.dataFreshness || "Unknown",
        lastRefresh:
          provider.lastRefresh || completedAt,
        metrics: provider.metrics || {},
        exceptions: [
          ...(provider.exceptions || []),
          ...credentialExceptions
        ],
        recommendations: [
          ...(provider.recommendations || []),
          ...credentialRecommendations
        ],
        providerOutput,
        authority: {
          registryAvailable: authority.registryAvailable,
          providerKey: authority.providerKey,
          providerStatus:
            authority.authority?.status || null,
          safeMode:
            authority.authority?.safeMode ?? null,
          credentialsPresent:
            authority.authority?.credentialsPresent ?? null,
          missingCredentials:
            authority.authority?.credentials?.missingEnv || [],
          operation: authority.operation,
          operationAuthorized:
            authority.operationBinding?.authorized ?? null,
          writeEnabled:
            authority.binding?.writeEnabled ?? null
        },
        evidence: {
          providerLoaded: true,
          initialized: true,
          requestedProvider,
          routedProvider: providerName,
          requestedAction,
          actionAvailable:
            typeof provider[requestedAction] === "function",
          authorityRegistryConsulted:
            authority.registryAvailable,
          authorityProviderKey:
            authority.providerKey,
          authorityOperation:
            authority.operation,
          credentialAwarenessApplied: true,
          metricsCaptured: Boolean(provider.metrics),
          exceptionsCaptured:
            Array.isArray(provider.exceptions),
          recommendationsCaptured:
            Array.isArray(provider.recommendations)
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
        action: requestedAction,
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
          `Verify provider action and connector configuration for ${providerName}.`,
          ...this.credentialRecommendations(authority)
        ],
        authority,
        evidence: {
          providerLoaded: true,
          initialized: false,
          requestedProvider,
          routedProvider: providerName,
          requestedAction,
          authorityRegistryConsulted:
            authority.registryAvailable,
          credentialAwarenessApplied: true,
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
    const authorityRegistry = safeRun(providerAuthority);
    const bindingRegistry = safeRun(providerBindings);

    return {
      ok: true,
      registeredProviders: Object.keys(this.providers),
      aliases: this.aliases,
      providerAuthority: {
        ok: authorityRegistry.ok,
        summary: authorityRegistry.summary || null
      },
      capabilityBindings: {
        ok: bindingRegistry.ok,
        summary: bindingRegistry.summary || null
      }
    };
  }
}

module.exports = new ProviderRouterService();


