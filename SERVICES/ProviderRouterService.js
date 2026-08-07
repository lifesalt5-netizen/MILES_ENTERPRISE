"use strict";

const MarketingProvider =
  require("../PROVIDERS/providers/MarketingProvider");
const OrionProvider =
  require("../PROVIDERS/providers/OrionProvider");
const WebsiteProvider =
  require("../PROVIDERS/providers/WebsiteProvider");
const SalesProvider =
  require("../PROVIDERS/providers/SalesProvider");
const GoogleWorkspaceProvider =
  require("../PROVIDERS/providers/GoogleWorkspaceProvider");

const providerAuthority =
  require("./ProviderAuthorityRegistryService");
const providerBindings =
  require("./ProviderCapabilityBindingService");
const constitutionalGuardian =
  require("./governance/ConstitutionalGuardianService");

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

function positiveNumber(value, fallback) {
  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : fallback;
}

function nowMs() {
  return Date.now();
}

function durationMs(startedAt) {
  return Math.max(
    0,
    nowMs() - startedAt
  );
}

class ProviderRouterService {
  constructor(options = {}) {
    this.providers = {
      MarketingProvider,
      OrionProvider,
      WebsiteProvider,
      SalesProvider,
      GoogleWorkspaceProvider
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
      revenue: "SalesProvider",
      revenueoperations: "SalesProvider",
      revenueprovider: "SalesProvider",

      google: "GoogleWorkspaceProvider",
      googleworkspace: "GoogleWorkspaceProvider",
      googleworkspaceprovider: "GoogleWorkspaceProvider",
      gmail: "GoogleWorkspaceProvider",
      calendar: "GoogleWorkspaceProvider",
      drive: "GoogleWorkspaceProvider",
      workspace: "GoogleWorkspaceProvider",

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
      SalesProvider: "crm",
      GoogleWorkspaceProvider: "google_workspace"
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
      },

      GoogleWorkspaceProvider: {
        auditWorkspace: "HEALTH_CHECK",
        reviewInbox: "VERIFY_MAILBOX",
        reviewCalendar: "HEALTH_CHECK",
        reviewDrive: "HEALTH_CHECK",
        refresh: "HEALTH_CHECK",
        initialize: "HEALTH_CHECK"
      }
    };

    this.providerInstances =
      new Map();

    this.registryCacheTtlMs =
      positiveNumber(
        options.registryCacheTtlMs ||
        process.env
          .MILES_PROVIDER_REGISTRY_CACHE_TTL_MS,
        60000
      );

    this.registryCache = {
      authorityRegistry: null,
      bindingRegistry: null,
      loadedAtMs: 0
    };

    this.metrics = {
      providerCacheHits: 0,
      providerCacheMisses: 0,
      providerInstancesCreated: 0,
      providerInstancesDisposed: 0,

      registryCacheHits: 0,
      registryCacheMisses: 0,

      executionsStarted: 0,
      executionsCompleted: 0,
      executionsFailed: 0,

      lastExecution: null
    };
  }

  normalizeProviderName(
    providerName = ""
  ) {
    const raw =
      String(providerName || "")
        .trim();

    if (!raw) {
      return null;
    }

    const aliasKey = raw
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");

    return (
      this.aliases[aliasKey] ||
      raw
    );
  }

  hasProvider(
    providerName = ""
  ) {
    const normalized =
      this.normalizeProviderName(
        providerName
      );

    return Boolean(
      normalized &&
      this.providers[normalized]
    );
  }

  isRegistryCacheFresh() {
    if (
      !this.registryCache.loadedAtMs
    ) {
      return false;
    }

    return (
      nowMs() -
      this.registryCache.loadedAtMs <
      this.registryCacheTtlMs
    );
  }

  loadRegistryState(
    options = {}
  ) {
    const forceRefresh =
      options === true ||
      options.forceRefresh === true;

    if (
      !forceRefresh &&
      this.isRegistryCacheFresh() &&
      this.registryCache
        .authorityRegistry &&
      this.registryCache
        .bindingRegistry
    ) {
      this.metrics
        .registryCacheHits += 1;

      return {
        authorityRegistry:
          this.registryCache
            .authorityRegistry,

        bindingRegistry:
          this.registryCache
            .bindingRegistry,

        cached: true,

        loadedAtMs:
          this.registryCache
            .loadedAtMs
      };
    }

    this.metrics
      .registryCacheMisses += 1;

    const authorityRegistry =
      safeRun(providerAuthority);

    const bindingRegistry =
      safeRun(providerBindings);

    this.registryCache = {
      authorityRegistry,
      bindingRegistry,
      loadedAtMs: nowMs()
    };

    return {
      authorityRegistry,
      bindingRegistry,
      cached: false,
      loadedAtMs:
        this.registryCache
          .loadedAtMs
    };
  }

  invalidateRegistryCache() {
    this.registryCache = {
      authorityRegistry: null,
      bindingRegistry: null,
      loadedAtMs: 0
    };

    return true;
  }

  authorityFor(
    providerName,
    action,
    options = {}
  ) {
    const providerKey =
      this.providerKeys[
        providerName
      ] || null;

    const operation =
      this.actionOperations[
        providerName
      ]?.[action] || null;

    const registryState =
      this.loadRegistryState(
        options
      );

    const authorityRegistry =
      registryState
        .authorityRegistry;

    const bindingRegistry =
      registryState
        .bindingRegistry;

    const authority =
      (
        authorityRegistry
          .providers || []
      )
        .find(provider =>
          provider.key ===
          providerKey
        ) || null;

    const binding =
      bindingRegistry
        .bindings?.[
          providerKey
        ] || null;

    const operationBinding =
      operation
        ? binding?.operations?.[
            operation
          ] || null
        : null;

    return {
      providerKey,
      operation,
      authority,
      binding,
      operationBinding,

      registryAvailable:
        Boolean(
          authorityRegistry.ok &&
          bindingRegistry.ok
        ),

      registryCached:
        registryState.cached,

      registryLoadedAt:
        registryState.loadedAtMs
          ? new Date(
              registryState
                .loadedAtMs
            ).toISOString()
          : null
    };
  }

  credentialRecommendations(
    authority
  ) {
    const missing =
      authority?.authority
        ?.credentials
        ?.missingEnv || [];

    if (!missing.length) {
      return [];
    }

    return [
      `Provider is operating in safe/read-only mode. Configure missing environment variable(s): ${missing.join(", ")}.`,

      "Do not enable write operations until credentials, rollback, and governance controls are verified."
    ];
  }

  credentialExceptions(
    authority
  ) {
    const missing =
      authority?.authority
        ?.credentials
        ?.missingEnv || [];

    if (!missing.length) {
      return [];
    }

    return [{
      type:
        "ProviderCredentials",

      severity:
        "Info",

      message:
        `Missing environment variable(s): ${missing.join(", ")}. Read-only authorized operations may continue.`
    }];
  }

  getProviderInstance(
    providerName
  ) {
    if (
      this.providerInstances
        .has(providerName)
    ) {
      this.metrics
        .providerCacheHits += 1;

      return {
        provider:
          this.providerInstances
            .get(providerName),

        cached: true
      };
    }

    const ProviderClass =
      this.providers[
        providerName
      ];

    if (!ProviderClass) {
      throw new Error(
        `Provider is not registered: ${providerName}`
      );
    }

    this.metrics
      .providerCacheMisses += 1;

    const provider =
      new ProviderClass();

    this.providerInstances.set(
      providerName,
      provider
    );

    this.metrics
      .providerInstancesCreated += 1;

    return {
      provider,
      cached: false
    };
  }

  async disposeProvider(
    providerName
  ) {
    const normalized =
      this.normalizeProviderName(
        providerName
      );

    if (
      !normalized ||
      !this.providerInstances
        .has(normalized)
    ) {
      return {
        ok: true,
        disposed: false,

        provider:
          normalized ||
          providerName ||
          null
      };
    }

    const provider =
      this.providerInstances
        .get(normalized);

    try {
      if (
        provider &&
        typeof provider.shutdown ===
          "function"
      ) {
        await provider.shutdown();
      }
    } finally {
      this.providerInstances
        .delete(normalized);

      this.metrics
        .providerInstancesDisposed += 1;
    }

    return {
      ok: true,
      disposed: true,
      provider: normalized
    };
  }

  async shutdown() {
    const results = [];

    for (
      const providerName of
      Array.from(
        this.providerInstances
          .keys()
      )
    ) {
      try {
        results.push(
          await this.disposeProvider(
            providerName
          )
        );
      } catch (err) {
        results.push({
          ok: false,
          disposed: false,
          provider:
            providerName,
          error:
            err.message
        });
      }
    }

    this.invalidateRegistryCache();

    return {
      ok:
        results.every(
          result =>
            result.ok !== false
        ),

      status:
        "SHUTDOWN",

      providers:
        results,

      completedAt:
        new Date()
          .toISOString()
    };
  }

  async invokeProvider(
    provider,
    action,
    task
  ) {
    const guardian =
      constitutionalGuardian.guard(
        task || {},
        {
          provider:
            task?.payload?.provider ||
            task?.provider ||
            provider?.constructor?.name ||
            "UNKNOWN",
          actor:
            task?.actor ||
            task?.payload?.actor ||
            "MILES",
          role:
            task?.role ||
            task?.payload?.role ||
            process.env.MILES_ACTOR_ROLE ||
            "MILES"
        }
      );

    if (!guardian.allowed) {
      return {
        ok: false,
        status:
          guardian.status ===
            "AWAITING_APPROVAL"
            ? "AWAITING_CEO_APPROVAL"
            : "GOVERNANCE_BLOCKED",
        governance: guardian,
        error:
          guardian.reason
      };
    }

    const normalizedAction =
      String(action || "")
        .trim();

    if (
      normalizedAction &&
      typeof provider[
        normalizedAction
      ] === "function"
    ) {
      return provider[
        normalizedAction
      ](task);
    }

    if (
      typeof provider
        .executeTask ===
      "function"
    ) {
      return provider
        .executeTask(task);
    }

    if (
      typeof provider
        .initialize ===
      "function"
    ) {
      return provider
        .initialize(task);
    }

    if (
      typeof provider
        .refresh ===
      "function"
    ) {
      return provider
        .refresh(task);
    }

    throw new Error(
      `Provider exposes no executable action: ${normalizedAction || "unspecified"}`
    );
  }

  resolveActionInvoked(
    provider,
    requestedAction
  ) {
    if (
      typeof provider[
        requestedAction
      ] === "function"
    ) {
      return requestedAction;
    }

    if (
      typeof provider
        .executeTask ===
      "function"
    ) {
      return "executeTask";
    }

    if (
      typeof provider
        .initialize ===
      "function"
    ) {
      return "initialize";
    }

    return "refresh";
  }

  buildTimingRecord(
    stages = {}
  ) {
    const normalized = {};

    for (
      const [name, value] of
      Object.entries(stages)
    ) {
      normalized[name] =
        Math.round(
          Number(value || 0) *
          1000
        ) / 1000;
    }

    return normalized;
  }

  async executeProviderTask(
    task = {}
  ) {
    const executionStartedAtMs =
      nowMs();

    const stages = {};

    this.metrics
      .executionsStarted += 1;

    const payload =
      task.payload ||
      task ||
      {};

    const requestedProvider =
      payload.provider || null;

    const normalizeStartedAt =
      nowMs();

    const providerName =
      this.normalizeProviderName(
        requestedProvider
      );

    stages.normalizeProvider =
      durationMs(
        normalizeStartedAt
      );

    if (!providerName) {
      const result =
        this.noProviderResult(
          task,
          "No provider was specified for this task."
        );

      stages.total =
        durationMs(
          executionStartedAtMs
        );

      result.performance = {
        stages:
          this.buildTimingRecord(
            stages
          ),

        providerInstanceCached:
          null,

        registryCached:
          null
      };

      this.metrics
        .executionsFailed += 1;

      this.metrics.lastExecution = {
        provider: null,
        action:
          payload.action || null,
        ok: false,

        stages:
          result.performance
            .stages,

        completedAt:
          new Date()
            .toISOString()
      };

      return result;
    }

    const ProviderClass =
      this.providers[
        providerName
      ];

    if (!ProviderClass) {
      const result =
        this.noProviderResult(
          task,
          `Provider is not registered: ${providerName}`
        );

      stages.total =
        durationMs(
          executionStartedAtMs
        );

      result.performance = {
        stages:
          this.buildTimingRecord(
            stages
          ),

        providerInstanceCached:
          null,

        registryCached:
          null
      };

      this.metrics
        .executionsFailed += 1;

      this.metrics.lastExecution = {
        provider:
          providerName,

        action:
          payload.action || null,

        ok: false,

        stages:
          result.performance
            .stages,

        completedAt:
          new Date()
            .toISOString()
      };

      return result;
    }

    const requestedAction =
      payload.action ||
      "refresh";

    const authorityStartedAt =
      nowMs();

    const authority =
      this.authorityFor(
        providerName,
        requestedAction
      );

    stages.authorityLookup =
      durationMs(
        authorityStartedAt
      );

    const startedAt =
      new Date()
        .toISOString();

    let provider = null;

    let providerInstanceCached =
      false;

    try {
      const providerStartedAt =
        nowMs();

      const providerState =
        this.getProviderInstance(
          providerName
        );

      provider =
        providerState.provider;

      providerInstanceCached =
        providerState.cached;

      stages.providerResolution =
        durationMs(
          providerStartedAt
        );

      const invokeStartedAt =
        nowMs();

      const providerOutput =
        await this.invokeProvider(
          provider,
          requestedAction,
          task
        );

      stages.providerInvocation =
        durationMs(
          invokeStartedAt
        );

      const resultStartedAt =
        nowMs();

      const completedAt =
        new Date()
          .toISOString();

      const credentialExceptions =
        this.credentialExceptions(
          authority
        );

      const credentialRecommendations =
        this.credentialRecommendations(
          authority
        );

      const result = {
        ok:
          provider.status !==
          "Critical",

        type:
          "PROVIDER_EXECUTION_RESULT",

        requestedProvider,
        provider:
          providerName,
        routedTo:
          providerName,
        action:
          requestedAction,

        actionInvoked:
          this.resolveActionInvoked(
            provider,
            requestedAction
          ),

        taskId:
          task.id || null,

        workPackageId:
          payload.workPackageId ||
          null,

        objective:
          payload.objective ||
          null,

        capability:
          payload.capability ||
          null,

        assignedTo:
          payload.assignedTo ||
          "MILES",

        department:
          payload.department ||
          null,

        status:
          provider.status ||
          "Unknown",

        dataFreshness:
          provider.dataFreshness ||
          "Unknown",

        lastRefresh:
          provider.lastRefresh ||
          completedAt,

        metrics:
          provider.metrics || {},

        exceptions: [
          ...(provider.exceptions ||
            []),

          ...credentialExceptions
        ],

        recommendations: [
          ...(provider.recommendations ||
            []),

          ...credentialRecommendations
        ],

        providerOutput,

        authority: {
          registryAvailable:
            authority
              .registryAvailable,

          registryCached:
            authority
              .registryCached,

          registryLoadedAt:
            authority
              .registryLoadedAt,

          providerKey:
            authority
              .providerKey,

          providerStatus:
            authority.authority
              ?.status || null,

          safeMode:
            authority.authority
              ?.safeMode ?? null,

          credentialsPresent:
            authority.authority
              ?.credentialsPresent ??
            null,

          missingCredentials:
            authority.authority
              ?.credentials
              ?.missingEnv || [],

          operation:
            authority.operation,

          operationAuthorized:
            authority
              .operationBinding
              ?.authorized ?? null,

          writeEnabled:
            authority.binding
              ?.writeEnabled ?? null
        },

        evidence: {
          providerLoaded: true,
          initialized: true,

          providerInstanceCached,

          requestedProvider,
          routedProvider:
            providerName,
          requestedAction,

          actionAvailable:
            typeof provider[
              requestedAction
            ] === "function",

          authorityRegistryConsulted:
            authority
              .registryAvailable,

          authorityRegistryCached:
            authority
              .registryCached,

          authorityProviderKey:
            authority.providerKey,

          authorityOperation:
            authority.operation,

          credentialAwarenessApplied:
            true,

          metricsCaptured:
            Boolean(
              provider.metrics
            ),

          exceptionsCaptured:
            Array.isArray(
              provider.exceptions
            ),

          recommendationsCaptured:
            Array.isArray(
              provider
                .recommendations
            )
        },

        startedAt,
        completedAt
      };

      stages.resultAssembly =
        durationMs(
          resultStartedAt
        );

      stages.total =
        durationMs(
          executionStartedAtMs
        );

      result.performance = {
        stages:
          this.buildTimingRecord(
            stages
          ),

        providerInstanceCached,

        registryCached:
          authority
            .registryCached,

        providerCacheSize:
          this.providerInstances
            .size,

        registryCacheTtlMs:
          this.registryCacheTtlMs
      };

      this.metrics
        .executionsCompleted += 1;

      this.metrics.lastExecution = {
        provider:
          providerName,

        action:
          requestedAction,

        ok:
          result.ok,

        providerInstanceCached,

        registryCached:
          authority
            .registryCached,

        stages:
          result.performance
            .stages,

        completedAt
      };

      return result;
    } catch (err) {
      stages.total =
        durationMs(
          executionStartedAtMs
        );

      const completedAt =
        new Date()
          .toISOString();

      const result = {
        ok: false,

        type:
          "PROVIDER_EXECUTION_RESULT",

        requestedProvider,

        provider:
          providerName,

        routedTo:
          providerName,

        action:
          requestedAction,

        taskId:
          task.id || null,

        workPackageId:
          payload.workPackageId ||
          null,

        objective:
          payload.objective ||
          null,

        capability:
          payload.capability ||
          null,

        assignedTo:
          payload.assignedTo ||
          "MILES",

        department:
          payload.department ||
          null,

        status:
          "FAILED",

        metrics: {},

        exceptions: [{
          type:
            "ProviderRouter",

          severity:
            "Critical",

          message:
            err.stack ||
            err.message
        }],

        recommendations: [
          `Verify provider action and connector configuration for ${providerName}.`,

          ...this
            .credentialRecommendations(
              authority
            )
        ],

        authority,

        evidence: {
          providerLoaded:
            Boolean(provider),

          initialized:
            false,

          providerInstanceCached,

          requestedProvider,

          routedProvider:
            providerName,

          requestedAction,

          authorityRegistryConsulted:
            authority
              .registryAvailable,

          authorityRegistryCached:
            authority
              .registryCached,

          credentialAwarenessApplied:
            true,

          error:
            err.stack ||
            err.message
        },

        performance: {
          stages:
            this.buildTimingRecord(
              stages
            ),

          providerInstanceCached,

          registryCached:
            authority
              .registryCached,

          providerCacheSize:
            this.providerInstances
              .size,

          registryCacheTtlMs:
            this.registryCacheTtlMs
        },

        startedAt,
        completedAt
      };

      this.metrics
        .executionsFailed += 1;

      this.metrics.lastExecution = {
        provider:
          providerName,

        action:
          requestedAction,

        ok: false,

        providerInstanceCached,

        registryCached:
          authority
            .registryCached,

        stages:
          result.performance
            .stages,

        error:
          err.message ||
          String(err),

        completedAt
      };

      return result;
    }
  }

  noProviderResult(
    task = {},
    reason = ""
  ) {
    const payload =
      task.payload ||
      task ||
      {};

    return {
      ok: false,

      type:
        "NO_PROVIDER_RESULT",

      provider:
        payload.provider ||
        null,

      action:
        payload.action ||
        null,

      taskId:
        task.id ||
        null,

      workPackageId:
        payload.workPackageId ||
        null,

      objective:
        payload.objective ||
        null,

      capability:
        payload.capability ||
        null,

      assignedTo:
        payload.assignedTo ||
        "MILES",

      department:
        payload.department ||
        null,

      status:
        "NO_PROVIDER",

      metrics: {},

      exceptions: [{
        type:
          "ProviderRouting",

        severity:
          "Info",

        message:
          reason
      }],

      recommendations: [
        "Register this provider or route it to an existing operational provider."
      ],

      evidence: {
        providerLoaded:
          false,

        reason
      },

      completedAt:
        new Date()
          .toISOString()
    };
  }

  getPerformanceState() {
    return {
      ok: true,

      providerCacheSize:
        this.providerInstances
          .size,

      providerCacheKeys:
        Array.from(
          this.providerInstances
            .keys()
        ),

      registryCacheTtlMs:
        this.registryCacheTtlMs,

      registryCacheAgeMs:
        this.registryCache
          .loadedAtMs
          ? Math.max(
              0,
              nowMs() -
              this.registryCache
                .loadedAtMs
            )
          : null,

      registryCacheLoaded:
        Boolean(
          this.registryCache
            .authorityRegistry &&
          this.registryCache
            .bindingRegistry
        ),

      metrics: {
        ...this.metrics
      }
    };
  }

  validateRegistry() {
    const registeredProviders =
      Object.keys(this.providers);

    const providerSet =
      new Set(registeredProviders);

    const invalidAliases =
      Object.entries(this.aliases)
        .filter(([, target]) =>
          !providerSet.has(target)
        )
        .map(([alias, target]) => ({
          alias,
          target
        }));

    const invalidProviderKeys =
      Object.entries(this.providerKeys)
        .filter(([providerName, providerKey]) =>
          !providerSet.has(providerName) ||
          !String(providerKey || "").trim()
        )
        .map(([providerName, providerKey]) => ({
          providerName,
          providerKey
        }));

    const invalidActionMaps =
      Object.keys(this.actionOperations)
        .filter(providerName =>
          !providerSet.has(providerName)
        );

    return {
      ok:
        registeredProviders.length > 0 &&
        invalidAliases.length === 0 &&
        invalidProviderKeys.length === 0 &&
        invalidActionMaps.length === 0,

      providerCount:
        registeredProviders.length,

      aliasCount:
        Object.keys(this.aliases).length,

      registeredProviders,
      invalidAliases,
      invalidProviderKeys,
      invalidActionMaps
    };
  }

  status() {
    const registryState =
      this.loadRegistryState();

    const authorityRegistry =
      registryState
        .authorityRegistry;

    const bindingRegistry =
      registryState
        .bindingRegistry;

    const validation =
      this.validateRegistry();

    return {
      ok:
        validation.ok &&
        authorityRegistry.ok === true &&
        bindingRegistry.ok === true,

      registeredProviders:
        validation.registeredProviders,

      aliases:
        this.aliases,

      validation,

      providerAuthority: {
        ok:
          authorityRegistry.ok,

        summary:
          authorityRegistry
            .summary || null
      },

      capabilityBindings: {
        ok:
          bindingRegistry.ok,

        summary:
          bindingRegistry
            .summary || null
      },

      performance:
        this.getPerformanceState()
    };
  }
}

module.exports =
  new ProviderRouterService();