"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

const registry =
  require("./InfrastructureRegistryService");

const credentialAuthority =
  require("./CredentialAuthorityService");

const providerRouter =
  require("./ProviderRouterService");

const ROOT =
  process.env.MILES_ROOT ||
  "D:\\P2GC_Intelligence\\MILES_ENTERPRISE";

const DATA_DIR = path.join(
  ROOT,
  "DATA",
  "infrastructure"
);

const STATE_FILE = path.join(
  DATA_DIR,
  "infrastructure_health_state.json"
);

const HISTORY_FILE = path.join(
  DATA_DIR,
  "infrastructure_health_history.jsonl"
);

const DEFAULT_INTERVAL_MS =
  positiveNumber(
    process.env.MILES_INFRASTRUCTURE_HEALTH_INTERVAL_MS,
    5 * 60 * 1000
  );

const DEFAULT_TIMEOUT_MS =
  positiveNumber(
    process.env.MILES_INFRASTRUCTURE_HEALTH_TIMEOUT_MS,
    45000
  );

const PROVIDER_CHECKS = Object.freeze([
  {
    infrastructureId: "orion",
    provider: "OrionProvider",
    action: "refresh",
    capability: "orion.health"
  },
  {
    infrastructureId: "instantly",
    provider: "MarketingProvider",
    action: "refresh",
    capability: "instantly.health"
  },
  {
    infrastructureId: "google_workspace",
    provider: "GoogleWorkspaceProvider",
    action: "auditWorkspace",
    capability: "google.workspace.health"
  },
  {
    infrastructureId: "website",
    provider: "WebsiteProvider",
    action: "verifyWebsite",
    capability: "website.health"
  }
]);

function positiveNumber(value, fallback) {
  const parsed = Number(value);

  return Number.isFinite(parsed) &&
    parsed > 0
    ? parsed
    : fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function ensureDir(directory) {
  fs.mkdirSync(directory, {
    recursive: true
  });
}

function safeWriteJson(file, value) {
  ensureDir(path.dirname(file));

  const temporary =
    `${file}.${process.pid}.${Date.now()}.tmp`;

  fs.writeFileSync(
    temporary,
    JSON.stringify(value, null, 2),
    "utf8"
  );

  try {
    fs.renameSync(
      temporary,
      file
    );
  } catch {
    fs.copyFileSync(
      temporary,
      file
    );

    fs.unlinkSync(
      temporary
    );
  }

  return true;
}

function appendHistory(record) {
  ensureDir(
    path.dirname(HISTORY_FILE)
  );

  fs.appendFileSync(
    HISTORY_FILE,
    `${JSON.stringify(record)}\n`,
    "utf8"
  );
}

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : fallback;
}

function normalizeStatus(value) {
  return String(value || "UNKNOWN")
    .trim()
    .toUpperCase();
}

function statusScore(status, ok) {
  const normalized =
    normalizeStatus(status);

  if (
    normalized === "HEALTHY" ||
    normalized === "READY" ||
    normalized === "OK" ||
    normalized === "INITIALIZED"
  ) {
    return 100;
  }

  if (
    normalized === "WATCH" ||
    normalized === "WARNING" ||
    normalized === "PARTIAL"
  ) {
    return 75;
  }

  if (
    normalized === "DEGRADED" ||
    normalized === "NEEDS_REVIEW"
  ) {
    return 55;
  }

  if (
    normalized === "CRITICAL" ||
    normalized === "FAILED" ||
    normalized === "ERROR" ||
    normalized === "OFFLINE"
  ) {
    return 10;
  }

  return ok === true ? 85 : 25;
}

function registryHealthStatus(score) {
  if (score >= 90) {
    return "HEALTHY";
  }

  if (score >= 70) {
    return "WATCH";
  }

  if (score >= 40) {
    return "DEGRADED";
  }

  return "CRITICAL";
}

function withTimeout(
  promise,
  timeoutMs,
  label
) {
  let timer = null;

  const timeoutPromise =
    new Promise((resolve, reject) => {
      timer = setTimeout(
        () => {
          reject(
            new Error(
              `${label} timed out after ${timeoutMs} ms`
            )
          );
        },
        timeoutMs
      );

      if (
        timer &&
        typeof timer.unref === "function"
      ) {
        timer.unref();
      }
    });

  return Promise.race([
    Promise.resolve(promise),
    timeoutPromise
  ]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

function pathHealth(
  infrastructureId,
  targetPath,
  options = {}
) {
  const startedAt = Date.now();

  const result = {
    infrastructureId,
    path: targetPath,
    exists: false,
    readable: false,
    writable: false,
    freeBytes: null,
    totalBytes: null,
    usedPercent: null,
    checks: [],
    errors: [],
    durationMs: 0
  };

  try {
    result.exists =
      fs.existsSync(targetPath);

    result.checks.push({
      name: "PATH_EXISTS",
      ok: result.exists
    });

    if (result.exists) {
      fs.readdirSync(targetPath, {
        withFileTypes: true
      });

      result.readable = true;

      result.checks.push({
        name: "PATH_READABLE",
        ok: true
      });
    }
  } catch (error) {
    result.errors.push(
      error.message
    );

    result.checks.push({
      name: "PATH_READABLE",
      ok: false,
      error: error.message
    });
  }

  if (
    options.testWrite === true &&
    result.exists
  ) {
    const writeDirectory =
      options.writeDirectory ||
      targetPath;

    const testFile = path.join(
      writeDirectory,
      `.miles_health_${process.pid}_${Date.now()}.tmp`
    );

    try {
      ensureDir(writeDirectory);

      fs.writeFileSync(
        testFile,
        "MILES infrastructure health check",
        "utf8"
      );

      result.writable =
        fs.existsSync(testFile);

      result.checks.push({
        name: "PATH_WRITABLE",
        ok: result.writable
      });
    } catch (error) {
      result.errors.push(
        error.message
      );

      result.checks.push({
        name: "PATH_WRITABLE",
        ok: false,
        error: error.message
      });
    } finally {
      try {
        fs.unlinkSync(testFile);
      } catch {
        // Test file may not have been created.
      }
    }
  }

  try {
    if (
      typeof fs.statfsSync === "function"
    ) {
      const stats =
        fs.statfsSync(targetPath);

      const blockSize =
        safeNumber(
          stats.bsize ||
          stats.frsize,
          0
        );

      const totalBytes =
        safeNumber(
          stats.blocks,
          0
        ) * blockSize;

      const freeBytes =
        safeNumber(
          stats.bavail ||
          stats.bfree,
          0
        ) * blockSize;

      result.totalBytes =
        totalBytes;

      result.freeBytes =
        freeBytes;

      result.usedPercent =
        totalBytes > 0
          ? Math.round(
              (
                (
                  totalBytes -
                  freeBytes
                ) /
                totalBytes
              ) *
              10000
            ) / 100
          : null;

      result.checks.push({
        name: "DISK_CAPACITY",
        ok:
          result.usedPercent === null ||
          result.usedPercent < 95,
        usedPercent:
          result.usedPercent
      });
    }
  } catch (error) {
    result.errors.push(
      error.message
    );
  }

  result.durationMs =
    Date.now() - startedAt;

  const requiredWrite =
    options.requireWrite === true;

  const healthy =
    result.exists &&
    result.readable &&
    (
      !requiredWrite ||
      result.writable
    ) &&
    (
      result.usedPercent === null ||
      result.usedPercent < 95
    );

  const warning =
    result.exists &&
    result.readable &&
    !healthy;

  result.ok = healthy;

  result.score =
    healthy
      ? 100
      : warning
        ? 70
        : 10;

  result.status =
    registryHealthStatus(
      result.score
    );

  return result;
}

function runtimeHealth() {
  const startedAt = Date.now();

  const memory =
    process.memoryUsage();

  const uptimeSeconds =
    process.uptime();

  const heapUsedMb =
    Math.round(
      memory.heapUsed /
      1024 /
      1024 *
      100
    ) / 100;

  const rssMb =
    Math.round(
      memory.rss /
      1024 /
      1024 *
      100
    ) / 100;

  const checks = [
    {
      name: "PROCESS_RUNNING",
      ok: true,
      pid: process.pid
    },
    {
      name: "ROOT_EXISTS",
      ok: fs.existsSync(ROOT),
      root: ROOT
    },
    {
      name: "NODE_VERSION",
      ok: Boolean(process.version),
      value: process.version
    },
    {
      name: "MEMORY_RSS",
      ok: rssMb < 1500,
      rssMb
    }
  ];

  const failed =
    checks.filter(
      check => check.ok === false
    );

  const score =
    failed.length === 0
      ? 100
      : Math.max(
          10,
          100 -
          failed.length * 25
        );

  return {
    infrastructureId:
      "miles_runtime",

    ok:
      failed.length === 0,

    status:
      registryHealthStatus(score),

    score,

    message:
      failed.length === 0
        ? "MILES runtime is operational."
        : `${failed.length} runtime check(s) failed.`,

    checks,

    metrics: {
      pid:
        process.pid,

      uptimeSeconds:
        Math.round(
          uptimeSeconds
        ),

      rssMb,

      heapUsedMb,

      platform:
        process.platform,

      architecture:
        process.arch,

      hostname:
        os.hostname(),

      nodeVersion:
        process.version
    },

    durationMs:
      Date.now() - startedAt,

    checkedAt:
      nowIso()
  };
}

function providerMessage(result) {
  const exceptions =
    Array.isArray(result?.exceptions)
      ? result.exceptions
      : [];

  if (exceptions.length > 0) {
    return exceptions
      .slice(0, 3)
      .map(item =>
        item.message ||
        item.error ||
        String(item)
      )
      .join(" | ");
  }

  return (
    result?.message ||
    result?.status ||
    "Provider health check completed."
  );
}

class InfrastructureHealthManagerService {
  constructor(options = {}) {
    this.intervalMs =
      positiveNumber(
        options.intervalMs,
        DEFAULT_INTERVAL_MS
      );

    this.timeoutMs =
      positiveNumber(
        options.timeoutMs,
        DEFAULT_TIMEOUT_MS
      );

    this.stateFile =
      options.stateFile ||
      STATE_FILE;

    this.timer = null;
    this.running = false;
    this.started = false;
    this.stopping = false;
    this.lastState = null;

    this.metrics = {
      cyclesStarted: 0,
      cyclesCompleted: 0,
      cyclesSkipped: 0,
      cyclesFailed: 0,
      providerChecks: 0,
      filesystemChecks: 0,
      startedAt: null,
      stoppedAt: null,
      lastCycleStartedAt: null,
      lastCycleCompletedAt: null,
      lastCycleDurationMs: null
    };
  }

  async checkProvider(definition) {
    const startedAt = Date.now();

    const task = {
      id:
        `INFRA_HEALTH_${definition.infrastructureId}_${Date.now()}`,

      type:
        "WORKFORCE_STEP",

      payload: {
        provider:
          definition.provider,

        action:
          definition.action,

        capability:
          definition.capability,

        objective:
          `Verify live infrastructure health for ${definition.infrastructureId}.`,

        assignedTo:
          "MILES",

        department:
          "Infrastructure",

        healthCheck:
          true
      }
    };

    try {
      const routedResult =
        await withTimeout(
          providerRouter
            .executeProviderTask(task),
          this.timeoutMs,
          `${definition.provider}.${definition.action}`
        );

      const providerOutput =
        routedResult
          ?.providerOutput ||
        routedResult;

      const rawStatus =
        providerOutput?.status ||
        routedResult?.status ||
        "UNKNOWN";

      const ok =
        routedResult?.ok !== false &&
        providerOutput?.ok !== false &&
        normalizeStatus(rawStatus) !==
          "CRITICAL";

      const score =
        statusScore(
          rawStatus,
          ok
        );

      const health = {
        infrastructureId:
          definition.infrastructureId,

        provider:
          definition.provider,

        action:
          definition.action,

        ok,

        status:
          registryHealthStatus(score),

        providerStatus:
          rawStatus,

        score,

        message:
          providerMessage(
            providerOutput
          ),

        checks: [{
          name:
            "PROVIDER_INVOCATION",

          ok,

          provider:
            definition.provider,

          action:
            definition.action,

          providerStatus:
            rawStatus
        }],

        metrics:
          providerOutput
            ?.metrics ||
          routedResult
            ?.metrics ||
          {},

        exceptions:
          providerOutput
            ?.exceptions ||
          routedResult
            ?.exceptions ||
          [],

        recommendations:
          providerOutput
            ?.recommendations ||
          routedResult
            ?.recommendations ||
          [],

        performance:
          routedResult
            ?.performance ||
          null,

        durationMs:
          Date.now() - startedAt,

        checkedAt:
          nowIso()
      };

      registry.setHealth(
        definition.infrastructureId,
        {
          status:
            health.status,

          score:
            health.score,

          message:
            health.message,

          checks:
            health.checks,

          checkedAt:
            health.checkedAt
        }
      );

      this.metrics.providerChecks += 1;

      return health;
    } catch (error) {
      const health = {
        infrastructureId:
          definition.infrastructureId,

        provider:
          definition.provider,

        action:
          definition.action,

        ok: false,

        status:
          "CRITICAL",

        providerStatus:
          "FAILED",

        score: 10,

        message:
          error.message,

        checks: [{
          name:
            "PROVIDER_INVOCATION",

          ok: false,

          provider:
            definition.provider,

          action:
            definition.action,

          error:
            error.message
        }],

        metrics: {},

        exceptions: [{
          type:
            "InfrastructureHealthCheck",

          severity:
            "Critical",

          message:
            error.message
        }],

        recommendations: [
          `Inspect ${definition.provider} and retry its health check.`
        ],

        durationMs:
          Date.now() - startedAt,

        checkedAt:
          nowIso()
      };

      registry.setHealth(
        definition.infrastructureId,
        {
          status:
            health.status,

          score:
            health.score,

          message:
            health.message,

          checks:
            health.checks,

          checkedAt:
            health.checkedAt
        }
      );

      this.metrics.providerChecks += 1;

      return health;
    }
  }

  checkFilesystems() {
    const cDrive =
      pathHealth(
        "filesystem_c",
        "C:\\",
        {
          testWrite: true,
          requireWrite: false,
          writeDirectory:
            process.env.TEMP ||
            path.join(
              os.homedir(),
              "AppData",
              "Local",
              "Temp"
            )
        }
      );

    const dDrive =
      pathHealth(
        "filesystem_d",
        "D:\\",
        {
          testWrite: true,
          requireWrite: true,
          writeDirectory:
            path.join(
              ROOT,
              "DATA",
              "runtime"
            )
        }
      );

    registry.setHealth(
      "filesystem_c",
      {
        status:
          cDrive.status,

        score:
          cDrive.score,

        message:
          cDrive.ok
            ? "C drive is readable and operational."
            : "C drive health requires review.",

        checks:
          cDrive.checks,

        checkedAt:
          nowIso()
      }
    );

    registry.setHealth(
      "filesystem_d",
      {
        status:
          dDrive.status,

        score:
          dDrive.score,

        message:
          dDrive.ok
            ? "D drive is readable, writable in the MILES runtime area, and operational."
            : "D drive health requires review.",

        checks:
          dDrive.checks,

        checkedAt:
          nowIso()
      }
    );

    this.metrics.filesystemChecks += 2;

    return [
      cDrive,
      dDrive
    ];
  }

  checkDomains() {
    const domainCredentials =
      credentialAuthority.get(
        "domains"
      );

    const credentialStatus =
      domainCredentials
        ?.status ||
      "UNKNOWN";

    const ready =
      domainCredentials
        ?.ready === true;

    const score =
      ready
        ? 90
        : credentialStatus ===
            "PARTIAL"
          ? 65
          : 35;

    const health = {
      infrastructureId:
        "domains",

      ok:
        ready,

      status:
        registryHealthStatus(
          score
        ),

      score,

      message:
        ready
          ? "Domain-management credentials are available."
          : "Domain inventory is registered, but live registrar management is not yet authenticated.",

      checks: [{
        name:
          "DOMAIN_CREDENTIAL_AUTHORITY",

        ok:
          ready,

        credentialStatus
      }],

      checkedAt:
        nowIso()
    };

    registry.setHealth(
      "domains",
      health
    );

    return health;
  }

  async runCycle(options = {}) {
    if (this.running) {
      this.metrics.cyclesSkipped += 1;

      return {
        ok: false,
        status:
          "CYCLE_ALREADY_RUNNING",
        generatedAt:
          nowIso()
      };
    }

    this.running = true;
    this.metrics.cyclesStarted += 1;
    this.metrics.lastCycleStartedAt =
      nowIso();

    const startedAt =
      Date.now();

    try {
      const credentialState =
        credentialAuthority.scan();

      const runtime =
        runtimeHealth();

      registry.setHealth(
        "miles_runtime",
        {
          status:
            runtime.status,

          score:
            runtime.score,

          message:
            runtime.message,

          checks:
            runtime.checks,

          checkedAt:
            runtime.checkedAt
        }
      );

      const filesystems =
        this.checkFilesystems();

      const domains =
        this.checkDomains();

      const providers = [];

      for (
        const definition of
        PROVIDER_CHECKS
      ) {
        if (
          options.skipProviders === true
        ) {
          continue;
        }

        providers.push(
          await this.checkProvider(
            definition
          )
        );
      }

      const registrySummary =
        registry.summary();

      const failedChecks = [
        runtime,
        domains,
        ...filesystems,
        ...providers
      ].filter(
        item =>
          item.ok === false
      );

      const state = {
        ok:
          failedChecks.length === 0,

        type:
          "INFRASTRUCTURE_HEALTH_STATE",

        generatedAt:
          nowIso(),

        durationMs:
          Date.now() -
          startedAt,

        credentialState: {
          status:
            credentialAuthority
              .summary()
              .status,

          summary:
            credentialState
              .summary
        },

        runtime,

        filesystems,

        domains,

        providers,

        registry:
          registrySummary,

        failures:
          failedChecks.map(
            item => ({
              infrastructureId:
                item.infrastructureId,

              status:
                item.status,

              score:
                item.score,

              message:
                item.message
            })
          )
      };

      this.lastState =
        state;

      safeWriteJson(
        this.stateFile,
        state
      );

      appendHistory({
        event:
          "INFRASTRUCTURE_HEALTH_CYCLE_COMPLETED",

        generatedAt:
          state.generatedAt,

        durationMs:
          state.durationMs,

        ok:
          state.ok,

        failures:
          state.failures
      });

      this.metrics.cyclesCompleted += 1;
      this.metrics.lastCycleCompletedAt =
        state.generatedAt;
      this.metrics.lastCycleDurationMs =
        state.durationMs;

      return state;
    } catch (error) {
      this.metrics.cyclesFailed += 1;

      const state = {
        ok: false,

        type:
          "INFRASTRUCTURE_HEALTH_STATE",

        status:
          "CYCLE_FAILED",

        generatedAt:
          nowIso(),

        durationMs:
          Date.now() -
          startedAt,

        error:
          error.stack ||
          error.message
      };

      this.lastState =
        state;

      safeWriteJson(
        this.stateFile,
        state
      );

      appendHistory({
        event:
          "INFRASTRUCTURE_HEALTH_CYCLE_FAILED",

        generatedAt:
          state.generatedAt,

        durationMs:
          state.durationMs,

        error:
          error.message
      });

      return state;
    } finally {
      this.running = false;
    }
  }

  async start(options = {}) {
    if (this.started) {
      return {
        ok: true,
        status:
          "ALREADY_STARTED",
        intervalMs:
          this.intervalMs
      };
    }

    this.started = true;
    this.stopping = false;
    this.metrics.startedAt =
      nowIso();

    const runImmediately =
      options.runImmediately !==
      false;

    if (runImmediately) {
      await this.runCycle();
    }

    this.timer = setInterval(
      () => {
        this.runCycle().catch(
          error => {
            console.error(
              "[InfrastructureHealthManager] cycle failed:",
              error
            );
          }
        );
      },
      this.intervalMs
    );

    if (
      this.timer &&
      typeof this.timer.unref ===
        "function"
    ) {
      this.timer.unref();
    }

    return {
      ok: true,
      status:
        "STARTED",
      intervalMs:
        this.intervalMs,
      timeoutMs:
        this.timeoutMs,
      startedAt:
        this.metrics.startedAt
    };
  }

  async stop(options = {}) {
    if (this.timer) {
      clearInterval(
        this.timer
      );

      this.timer = null;
    }

    this.stopping = true;
    this.started = false;
    this.metrics.stoppedAt =
      nowIso();

    if (
      options.shutdownProviders ===
      true &&
      providerRouter &&
      typeof providerRouter.shutdown ===
        "function"
    ) {
      await providerRouter.shutdown();
    }

    return {
      ok: true,
      status:
        "STOPPED",
      stoppedAt:
        this.metrics.stoppedAt
    };
  }

  status() {
    return {
      ok: true,

      service:
        "InfrastructureHealthManagerService",

      started:
        this.started,

      running:
        this.running,

      intervalMs:
        this.intervalMs,

      timeoutMs:
        this.timeoutMs,

      stateFile:
        this.stateFile,

      metrics: {
        ...this.metrics
      },

      lastState:
        this.lastState
          ? {
              ok:
                this.lastState.ok,

              generatedAt:
                this.lastState
                  .generatedAt,

              durationMs:
                this.lastState
                  .durationMs,

              failures:
                this.lastState
                  .failures ||
                []
            }
          : null
    };
  }

  healthCheck() {
    const status =
      this.status();

    return {
      ok:
        this.started ||
        this.lastState !== null,

      service:
        "InfrastructureHealthManagerService",

      status:
        this.running
          ? "RUNNING"
          : this.started
            ? "IDLE"
            : this.lastState
              ? "READY"
              : "NOT_STARTED",

      lastCycle:
        status.lastState,

      checkedAt:
        nowIso()
    };
  }

  async execute(task = {}) {
    const payload =
      task.payload ||
      task ||
      {};

    const action =
      String(
        payload.action ||
        task.action ||
        "status"
      )
        .trim()
        .toLowerCase();

    switch (action) {
      case "start":
        return this.start(
          payload.options || {}
        );

      case "stop":
      case "shutdown":
        return this.stop(
          payload.options || {}
        );

      case "run":
      case "refresh":
      case "cycle":
        return this.runCycle(
          payload.options || {}
        );

      case "status":
        return this.status();

      case "health":
      case "healthcheck":
        return this.healthCheck();

      default:
        return {
          ok: false,
          status:
            "UNSUPPORTED_ACTION",
          action
        };
    }
  }
}

module.exports =
  new InfrastructureHealthManagerService();

module.exports.InfrastructureHealthManagerService =
  InfrastructureHealthManagerService;