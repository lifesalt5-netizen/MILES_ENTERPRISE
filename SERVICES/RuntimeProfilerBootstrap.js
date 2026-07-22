"use strict";

/**
 * MILES ENTERPRISE
 * BUILD049 — Enterprise Runtime Telemetry
 *
 * File:
 * SERVICES/RuntimeProfilerBootstrap.js
 *
 * Purpose:
 * - Automatically profile critical MILES services.
 * - Measure sync and async execution durations.
 * - Track count, average, minimum, maximum, recent, and p95 duration.
 * - Record failures separately.
 * - Persist rolling telemetry to:
 *   DATA/runtime/runtime_profile.json
 *
 * Integration:
 * Run MILES with NODE_OPTIONS:
 *
 * $env:NODE_OPTIONS="--require=D:\P2GC_Intelligence\MILES_ENTERPRISE\SERVICES\RuntimeProfilerBootstrap.js"
 * node StartMilesProduction.js
 *
 * This profiler:
 * - Does not modify business results.
 * - Does not change governance.
 * - Does not execute business actions.
 * - Does not require edits to existing production files.
 * - Adds only lightweight timing around selected methods.
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");

const ROOT =
  process.env.MILES_ROOT ||
  path.resolve(__dirname, "..");

const OUTPUT_DIR =
  path.join(
    ROOT,
    "DATA",
    "runtime"
  );

const OUTPUT_FILE =
  path.join(
    OUTPUT_DIR,
    "runtime_profile.json"
  );

const PROCESS_FILE =
  path.join(
    OUTPUT_DIR,
    `runtime_profile_process_${process.pid}.json`
  );

const FLUSH_INTERVAL_MS =
  Number(
    process.env.MILES_PROFILE_FLUSH_INTERVAL_MS ||
    15000
  );

const MAX_SAMPLES =
  Number(
    process.env.MILES_PROFILE_MAX_SAMPLES ||
    500
  );

const SLOW_OPERATION_MS =
  Number(
    process.env.MILES_PROFILE_SLOW_OPERATION_MS ||
    1000
  );

const PROFILE_ENABLED =
  String(
    process.env.MILES_RUNTIME_PROFILE_ENABLED ??
    "true"
  )
    .trim()
    .toLowerCase() !== "false";

const INCLUDE_SUCCESS_LOGS =
  String(
    process.env.MILES_PROFILE_LOG_SUCCESS ??
    "false"
  )
    .trim()
    .toLowerCase() === "true";

const state = {
  ok: true,
  type: "MILES_RUNTIME_PROFILE",
  build: "BUILD049",
  processId: process.pid,
  processTitle: process.title,
  startedAt: new Date().toISOString(),
  generatedAt: null,
  root: ROOT,
  configuration: {
    enabled: PROFILE_ENABLED,
    flushIntervalMs: FLUSH_INTERVAL_MS,
    maxSamples: MAX_SAMPLES,
    slowOperationMs: SLOW_OPERATION_MS,
    logSuccessfulOperations: INCLUDE_SUCCESS_LOGS
  },
  process: {
    pid: process.pid,
    nodeVersion: process.version,
    platform: process.platform,
    architecture: process.arch,
    command:
      [
        process.execPath,
        ...process.execArgv,
        ...process.argv.slice(1)
      ].join(" "),
    cwd: process.cwd()
  },
  metrics: {},
  slowOperations: [],
  recentFailures: [],
  wrappedMethods: [],
  totals: {
    operations: 0,
    completed: 0,
    failed: 0,
    slow: 0,
    totalDurationMs: 0
  }
};

const wrappedFunctions =
  new WeakSet();

const wrappedTargets =
  new Set();

let flushTimer = null;
let flushing = false;
let shuttingDown = false;

/* ============================================================
   FILE HELPERS
============================================================ */

function ensureDirectory(directory) {
  try {
    fs.mkdirSync(
      directory,
      {
        recursive: true
      }
    );
  } catch {
    // Profiling must never interrupt MILES.
  }
}

function readJson(
  file,
  fallback
) {
  try {
    if (!fs.existsSync(file)) {
      return fallback;
    }

    const text =
      fs
        .readFileSync(
          file,
          "utf8"
        )
        .replace(
          /^\uFEFF/,
          ""
        );

    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(
  file,
  value
) {
  ensureDirectory(
    path.dirname(file)
  );

  const temporaryFile =
    `${file}.tmp_${process.pid}_${Date.now()}`;

  try {
    fs.writeFileSync(
      temporaryFile,
      JSON.stringify(
        value,
        null,
        2
      ),
      "utf8"
    );

    try {
      fs.renameSync(
        temporaryFile,
        file
      );
    } catch {
      fs.copyFileSync(
        temporaryFile,
        file
      );

      fs.unlinkSync(
        temporaryFile
      );
    }

    return true;
  } catch {
    try {
      if (
        fs.existsSync(
          temporaryFile
        )
      ) {
        fs.unlinkSync(
          temporaryFile
        );
      }
    } catch {
      // Best effort cleanup.
    }

    return false;
  }
}

/* ============================================================
   VALUE HELPERS
============================================================ */

function nowIso() {
  return new Date().toISOString();
}

function durationMilliseconds(
  started
) {
  const elapsed =
    process.hrtime.bigint() -
    started;

  return (
    Number(elapsed) /
    1_000_000
  );
}

function rounded(
  value,
  places = 2
) {
  const factor =
    10 ** places;

  return (
    Math.round(
      Number(value || 0) *
      factor
    ) /
    factor
  );
}

function percentile(
  values,
  requestedPercentile
) {
  if (
    !Array.isArray(values) ||
    values.length === 0
  ) {
    return 0;
  }

  const sorted =
    [...values].sort(
      (left, right) =>
        left - right
    );

  const index =
    Math.min(
      sorted.length - 1,
      Math.max(
        0,
        Math.ceil(
          requestedPercentile *
          sorted.length
        ) - 1
      )
    );

  return sorted[index];
}

function safeErrorMessage(
  error
) {
  if (!error) {
    return "Unknown error";
  }

  return (
    error.stack ||
    error.message ||
    String(error)
  );
}

function memorySnapshot() {
  try {
    const memory =
      process.memoryUsage();

    return {
      rssMB:
        rounded(
          memory.rss /
          1024 /
          1024
        ),

      heapTotalMB:
        rounded(
          memory.heapTotal /
          1024 /
          1024
        ),

      heapUsedMB:
        rounded(
          memory.heapUsed /
          1024 /
          1024
        ),

      externalMB:
        rounded(
          memory.external /
          1024 /
          1024
        ),

      arrayBuffersMB:
        rounded(
          (
            memory.arrayBuffers ||
            0
          ) /
          1024 /
          1024
        )
    };
  } catch {
    return {};
  }
}

/* ============================================================
   METRIC RECORDING
============================================================ */

function metricFor(
  name
) {
  if (!state.metrics[name]) {
    state.metrics[name] = {
      name,
      count: 0,
      completed: 0,
      failed: 0,
      slow: 0,
      totalMs: 0,
      averageMs: 0,
      minimumMs: null,
      maximumMs: 0,
      latestMs: 0,
      p50Ms: 0,
      p95Ms: 0,
      p99Ms: 0,
      firstObservedAt: null,
      lastObservedAt: null,
      lastFailureAt: null,
      lastError: null,
      samples: []
    };
  }

  return state.metrics[name];
}

function recordResult({
  name,
  durationMs,
  ok,
  error,
  startedAt,
  metadata
}) {
  try {
    const metric =
      metricFor(name);

    const finishedAt =
      nowIso();

    const normalizedDuration =
      rounded(
        durationMs,
        3
      );

    metric.count += 1;
    metric.totalMs +=
      normalizedDuration;

    metric.latestMs =
      normalizedDuration;

    metric.averageMs =
      rounded(
        metric.totalMs /
        metric.count,
        3
      );

    metric.minimumMs =
      metric.minimumMs === null
        ? normalizedDuration
        : Math.min(
            metric.minimumMs,
            normalizedDuration
          );

    metric.maximumMs =
      Math.max(
        metric.maximumMs,
        normalizedDuration
      );

    metric.firstObservedAt =
      metric.firstObservedAt ||
      startedAt;

    metric.lastObservedAt =
      finishedAt;

    if (ok) {
      metric.completed += 1;
      state.totals.completed += 1;
    } else {
      metric.failed += 1;
      metric.lastFailureAt =
        finishedAt;

      metric.lastError =
        safeErrorMessage(error);

      state.totals.failed += 1;

      state.recentFailures.unshift({
        name,
        startedAt,
        finishedAt,
        durationMs:
          normalizedDuration,
        error:
          safeErrorMessage(error),
        metadata:
          metadata || null
      });

      state.recentFailures =
        state.recentFailures.slice(
          0,
          50
        );
    }

    metric.samples.push(
      normalizedDuration
    );

    if (
      metric.samples.length >
      MAX_SAMPLES
    ) {
      metric.samples.splice(
        0,
        metric.samples.length -
        MAX_SAMPLES
      );
    }

    metric.p50Ms =
      rounded(
        percentile(
          metric.samples,
          0.5
        ),
        3
      );

    metric.p95Ms =
      rounded(
        percentile(
          metric.samples,
          0.95
        ),
        3
      );

    metric.p99Ms =
      rounded(
        percentile(
          metric.samples,
          0.99
        ),
        3
      );

    state.totals.operations += 1;
    state.totals.totalDurationMs +=
      normalizedDuration;

    if (
      normalizedDuration >=
      SLOW_OPERATION_MS
    ) {
      metric.slow += 1;
      state.totals.slow += 1;

      state.slowOperations.unshift({
        name,
        startedAt,
        finishedAt,
        durationMs:
          normalizedDuration,
        ok,
        metadata:
          metadata || null,
        error:
          ok
            ? null
            : safeErrorMessage(error)
      });

      state.slowOperations =
        state.slowOperations.slice(
          0,
          100
        );

      console.warn(
        `[MILES PROFILE] SLOW ${name}: ${normalizedDuration} ms`
      );
    } else if (
      INCLUDE_SUCCESS_LOGS &&
      ok
    ) {
      console.log(
        `[MILES PROFILE] ${name}: ${normalizedDuration} ms`
      );
    }
  } catch {
    // Telemetry must never interrupt execution.
  }
}

/* ============================================================
   FUNCTION WRAPPING
============================================================ */

function isPromiseLike(
  value
) {
  return Boolean(
    value &&
    typeof value.then === "function"
  );
}

function wrapFunction(
  target,
  methodName,
  profileName,
  metadataFactory
) {
  try {
    if (
      !target ||
      typeof target[methodName] !==
        "function"
    ) {
      return false;
    }

    const original =
      target[methodName];

    if (
      wrappedFunctions.has(
        original
      ) ||
      original.__milesProfileWrapped ===
        true
    ) {
      return false;
    }

    const wrapped =
      function profiledMilesMethod(
        ...args
      ) {
        const startedAt =
          nowIso();

        const started =
          process.hrtime.bigint();

        let metadata = null;

        try {
          if (
            typeof metadataFactory ===
            "function"
          ) {
            metadata =
              metadataFactory(
                args,
                this
              );
          }
        } catch {
          metadata = null;
        }

        let result;

        try {
          result =
            original.apply(
              this,
              args
            );
        } catch (error) {
          recordResult({
            name:
              profileName,
            durationMs:
              durationMilliseconds(
                started
              ),
            ok: false,
            error,
            startedAt,
            metadata
          });

          throw error;
        }

        if (
          isPromiseLike(result)
        ) {
          return result.then(
            value => {
              recordResult({
                name:
                  profileName,
                durationMs:
                  durationMilliseconds(
                    started
                  ),
                ok: true,
                error: null,
                startedAt,
                metadata
              });

              return value;
            },
            error => {
              recordResult({
                name:
                  profileName,
                durationMs:
                  durationMilliseconds(
                    started
                  ),
                ok: false,
                error,
                startedAt,
                metadata
              });

              throw error;
            }
          );
        }

        recordResult({
          name:
            profileName,
          durationMs:
            durationMilliseconds(
              started
            ),
          ok: true,
          error: null,
          startedAt,
          metadata
        });

        return result;
      };

    Object.defineProperty(
      wrapped,
      "__milesProfileWrapped",
      {
        value: true,
        configurable: false,
        enumerable: false,
        writable: false
      }
    );

    Object.defineProperty(
      wrapped,
      "__milesOriginalFunction",
      {
        value: original,
        configurable: false,
        enumerable: false,
        writable: false
      }
    );

    try {
      Object.defineProperty(
        wrapped,
        "name",
        {
          value:
            original.name ||
            methodName,
          configurable: true
        }
      );
    } catch {
      // Function name preservation is optional.
    }

    wrappedFunctions.add(
      original
    );

    wrappedFunctions.add(
      wrapped
    );

    target[methodName] =
      wrapped;

    const wrapId =
      `${profileName}::${methodName}`;

    if (
      !wrappedTargets.has(
        wrapId
      )
    ) {
      wrappedTargets.add(
        wrapId
      );

      state.wrappedMethods.push({
        profileName,
        methodName,
        wrappedAt:
          nowIso(),
        pid:
          process.pid
      });
    }

    return true;
  } catch {
    return false;
  }
}

function wrapExportedTarget(
  exported,
  specification
) {
  if (!exported) {
    return;
  }

  const candidates = [];

  if (
    typeof exported ===
      "function" &&
    exported.prototype
  ) {
    candidates.push(
      exported.prototype
    );
  }

  if (
    typeof exported ===
      "object" ||
    typeof exported ===
      "function"
  ) {
    candidates.push(
      exported
    );
  }

  if (
    exported.default &&
    (
      typeof exported.default ===
        "object" ||
      typeof exported.default ===
        "function"
    )
  ) {
    candidates.push(
      exported.default
    );

    if (
      exported.default.prototype
    ) {
      candidates.push(
        exported.default.prototype
      );
    }
  }

  for (
    const candidate of candidates
  ) {
    for (
      const method of
        specification.methods
    ) {
      wrapFunction(
        candidate,
        method.name,
        method.profileName,
        method.metadata
      );
    }
  }
}

/* ============================================================
   TARGET DEFINITIONS
============================================================ */

const TARGETS = {
  "ExecutionService.js": {
    methods: [
      {
        name: "runNext",
        profileName:
          "ExecutionService.runNext"
      },
      {
        name: "execute",
        profileName:
          "ExecutionService.execute",
        metadata: args => ({
          taskId:
            args[0]?.id ||
            null,
          type:
            args[0]?.type ||
            null,
          action:
            args[0]?.action ||
            args[0]?.payload
              ?.action ||
            null
        })
      },
      {
        name:
          "executeWorkforceTask",
        profileName:
          "ExecutionService.executeWorkforceTask",
        metadata: args => ({
          taskId:
            args[0]?.id ||
            null,
          provider:
            args[0]?.payload
              ?.provider ||
            null,
          action:
            args[0]?.payload
              ?.action ||
            null
        })
      },
      {
        name:
          "executeConnectorTask",
        profileName:
          "ExecutionService.executeConnectorTask",
        metadata: args => ({
          taskId:
            args[0]?.id ||
            null,
          provider:
            args[1] ||
            null,
          connector:
            args[2] ||
            null,
          action:
            args[3] ||
            null
        })
      }
    ]
  },

  "WorkforceExecutionService.js": {
    methods: [
      {
        name:
          "executeAndVerify",
        profileName:
          "WorkforceExecutionService.executeAndVerify",
        metadata: args => ({
          taskId:
            args[0]?.id ||
            null,
          provider:
            args[0]?.payload
              ?.provider ||
            null,
          action:
            args[0]?.payload
              ?.action ||
            null
        })
      },
      {
        name: "execute",
        profileName:
          "WorkforceExecutionService.execute"
      },
      {
        name: "verify",
        profileName:
          "WorkforceExecutionService.verify"
      }
    ]
  },

  "CapabilityDispatcherService.js": {
    methods: [
      {
        name: "resolve",
        profileName:
          "CapabilityDispatcherService.resolve"
      },
      {
        name:
          "executeService",
        profileName:
          "CapabilityDispatcherService.executeService"
      }
    ]
  },

  "WorkQueueService.js": {
    methods: [
      {
        name: "list",
        profileName:
          "WorkQueueService.list"
      },
      {
        name: "update",
        profileName:
          "WorkQueueService.update"
      },
      {
        name: "getStatus",
        profileName:
          "WorkQueueService.getStatus"
      },
      {
        name: "reload",
        profileName:
          "WorkQueueService.reload"
      }
    ]
  },

  "TaskQueueService.js": {
    methods: [
      {
        name: "list",
        profileName:
          "TaskQueueService.list"
      },
      {
        name: "update",
        profileName:
          "TaskQueueService.update"
      },
      {
        name: "getStatus",
        profileName:
          "TaskQueueService.getStatus"
      },
      {
        name: "reload",
        profileName:
          "TaskQueueService.reload"
      }
    ]
  },

  "BusinessSnapshotService.js": {
    methods: [
      {
        name: "run",
        profileName:
          "BusinessSnapshotService.run"
      },
      {
        name: "build",
        profileName:
          "BusinessSnapshotService.build"
      }
    ]
  },

  "DashboardDataService.js": {
    methods: [
      {
        name: "run",
        profileName:
          "DashboardDataService.run"
      },
      {
        name: "build",
        profileName:
          "DashboardDataService.build"
      }
    ]
  },

  "ExecutiveDashboardService.js": {
    methods: [
      {
        name: "run",
        profileName:
          "ExecutiveDashboardService.run"
      },
      {
        name: "renderHtml",
        profileName:
          "ExecutiveDashboardService.renderHtml"
      },
      {
        name: "renderReport",
        profileName:
          "ExecutiveDashboardService.renderReport"
      }
    ]
  },

  "LiveBusinessStateService.js": {
    methods: [
      {
        name: "collect",
        profileName:
          "LiveBusinessStateService.collect"
      },
      {
        name: "enrich",
        profileName:
          "LiveBusinessStateService.enrich"
      },
      {
        name:
          "discoverJsonFiles",
        profileName:
          "LiveBusinessStateService.discoverJsonFiles"
      },
      {
        name:
          "collectCollection",
        profileName:
          "LiveBusinessStateService.collectCollection"
      }
    ]
  },

  "RuntimeMetricsService.js": {
    methods: [
      {
        name: "run",
        profileName:
          "RuntimeMetricsService.run"
      },
      {
        name: "build",
        profileName:
          "RuntimeMetricsService.build"
      },
      {
        name: "write",
        profileName:
          "RuntimeMetricsService.write"
      }
    ]
  },

  "DashboardServerService.js": {
    methods: [
      {
        name: "run",
        profileName:
          "DashboardServerService.run"
      }
    ]
  },

  "OrionProvider.js": {
    methods: [
      {
        name: "execute",
        profileName:
          "OrionProvider.execute"
      },
      {
        name:
          "auditIntelligence",
        profileName:
          "OrionProvider.auditIntelligence"
      },
      {
        name: "refresh",
        profileName:
          "OrionProvider.refresh"
      }
    ]
  },

  "MarketingProvider.js": {
    methods: [
      {
        name: "execute",
        profileName:
          "MarketingProvider.execute"
      },
      {
        name: "audit",
        profileName:
          "MarketingProvider.audit"
      },
      {
        name: "refresh",
        profileName:
          "MarketingProvider.refresh"
      }
    ]
  },

  "SalesProvider.js": {
    methods: [
      {
        name: "execute",
        profileName:
          "SalesProvider.execute"
      },
      {
        name:
          "reviewPipeline",
        profileName:
          "SalesProvider.reviewPipeline"
      }
    ]
  }
};

/* ============================================================
   MODULE LOAD INTERCEPTION
============================================================ */

const originalModuleLoad =
  Module._load;

Module._load =
  function milesProfiledModuleLoad(
    request,
    parent,
    isMain
  ) {
    const exported =
      originalModuleLoad.apply(
        this,
        arguments
      );

    if (!PROFILE_ENABLED) {
      return exported;
    }

    try {
      let resolvedPath = null;

      try {
        resolvedPath =
          Module._resolveFilename(
            request,
            parent,
            isMain
          );
      } catch {
        resolvedPath =
          String(request || "");
      }

      const baseName =
        path.basename(
          String(
            resolvedPath ||
            request ||
            ""
          )
        );

      const specification =
        TARGETS[baseName];

      if (specification) {
        wrapExportedTarget(
          exported,
          specification
        );
      }
    } catch {
      // Never interfere with normal module loading.
    }

    return exported;
  };

/* ============================================================
   PROFILE SNAPSHOT
============================================================ */

function publicMetric(
  metric
) {
  return {
    name:
      metric.name,

    count:
      metric.count,

    completed:
      metric.completed,

    failed:
      metric.failed,

    slow:
      metric.slow,

    totalMs:
      rounded(
        metric.totalMs,
        3
      ),

    averageMs:
      rounded(
        metric.averageMs,
        3
      ),

    minimumMs:
      metric.minimumMs === null
        ? null
        : rounded(
            metric.minimumMs,
            3
          ),

    maximumMs:
      rounded(
        metric.maximumMs,
        3
      ),

    latestMs:
      rounded(
        metric.latestMs,
        3
      ),

    p50Ms:
      rounded(
        metric.p50Ms,
        3
      ),

    p95Ms:
      rounded(
        metric.p95Ms,
        3
      ),

    p99Ms:
      rounded(
        metric.p99Ms,
        3
      ),

    firstObservedAt:
      metric.firstObservedAt,

    lastObservedAt:
      metric.lastObservedAt,

    lastFailureAt:
      metric.lastFailureAt,

    lastError:
      metric.lastError
  };
}

function processSnapshot() {
  const metrics =
    Object.values(
      state.metrics
    )
      .map(publicMetric)
      .sort(
        (left, right) =>
          right.totalMs -
          left.totalMs
      );

  return {
    ok: true,
    type:
      "MILES_RUNTIME_PROFILE_PROCESS",
    build:
      "BUILD049",
    generatedAt:
      nowIso(),
    startedAt:
      state.startedAt,
    uptimeSeconds:
      rounded(
        process.uptime(),
        2
      ),
    process:
      state.process,
    memory:
      memorySnapshot(),
    configuration:
      state.configuration,
    totals: {
      ...state.totals,
      totalDurationMs:
        rounded(
          state.totals
            .totalDurationMs,
          3
        ),
      averageDurationMs:
        state.totals.operations > 0
          ? rounded(
              state.totals
                .totalDurationMs /
              state.totals
                .operations,
              3
            )
          : 0
    },
    metrics,
    slowOperations:
      state.slowOperations,
    recentFailures:
      state.recentFailures,
    wrappedMethods:
      state.wrappedMethods
  };
}

function mergeProcessProfiles(
  profiles
) {
  const combined =
    new Map();

  const slowOperations = [];
  const recentFailures = [];
  const processes = [];

  const totals = {
    operations: 0,
    completed: 0,
    failed: 0,
    slow: 0,
    totalDurationMs: 0
  };

  for (
    const profile of profiles
  ) {
    if (
      !profile ||
      profile.ok !== true
    ) {
      continue;
    }

    processes.push({
      pid:
        profile.process?.pid ||
        null,
      command:
        profile.process?.command ||
        null,
      startedAt:
        profile.startedAt ||
        null,
      uptimeSeconds:
        profile.uptimeSeconds ||
        0,
      memory:
        profile.memory ||
        {}
    });

    totals.operations +=
      Number(
        profile.totals
          ?.operations ||
        0
      );

    totals.completed +=
      Number(
        profile.totals
          ?.completed ||
        0
      );

    totals.failed +=
      Number(
        profile.totals
          ?.failed ||
        0
      );

    totals.slow +=
      Number(
        profile.totals
          ?.slow ||
        0
      );

    totals.totalDurationMs +=
      Number(
        profile.totals
          ?.totalDurationMs ||
        0
      );

    slowOperations.push(
      ...(
        profile.slowOperations ||
        []
      )
    );

    recentFailures.push(
      ...(
        profile.recentFailures ||
        []
      )
    );

    for (
      const metric of
        profile.metrics ||
        []
    ) {
      if (
        !combined.has(
          metric.name
        )
      ) {
        combined.set(
          metric.name,
          {
            name:
              metric.name,
            count: 0,
            completed: 0,
            failed: 0,
            slow: 0,
            totalMs: 0,
            minimumMs: null,
            maximumMs: 0,
            latestMs: 0,
            p50WeightedTotal: 0,
            p95WeightedTotal: 0,
            p99WeightedTotal: 0,
            firstObservedAt: null,
            lastObservedAt: null,
            lastFailureAt: null,
            lastError: null
          }
        );
      }

      const target =
        combined.get(
          metric.name
        );

      const count =
        Number(
          metric.count ||
          0
        );

      target.count += count;

      target.completed +=
        Number(
          metric.completed ||
          0
        );

      target.failed +=
        Number(
          metric.failed ||
          0
        );

      target.slow +=
        Number(
          metric.slow ||
          0
        );

      target.totalMs +=
        Number(
          metric.totalMs ||
          0
        );

      target.minimumMs =
        target.minimumMs === null
          ? metric.minimumMs
          : Math.min(
              target.minimumMs,
              metric.minimumMs ??
                target.minimumMs
            );

      target.maximumMs =
        Math.max(
          target.maximumMs,
          Number(
            metric.maximumMs ||
            0
          )
        );

      target.latestMs =
        Number(
          metric.latestMs ||
          target.latestMs
        );

      target.p50WeightedTotal +=
        Number(
          metric.p50Ms ||
          0
        ) *
        count;

      target.p95WeightedTotal +=
        Number(
          metric.p95Ms ||
          0
        ) *
        count;

      target.p99WeightedTotal +=
        Number(
          metric.p99Ms ||
          0
        ) *
        count;

      if (
        !target.firstObservedAt ||
        (
          metric.firstObservedAt &&
          metric.firstObservedAt <
            target.firstObservedAt
        )
      ) {
        target.firstObservedAt =
          metric.firstObservedAt;
      }

      if (
        !target.lastObservedAt ||
        (
          metric.lastObservedAt &&
          metric.lastObservedAt >
            target.lastObservedAt
        )
      ) {
        target.lastObservedAt =
          metric.lastObservedAt;
      }

      if (
        !target.lastFailureAt ||
        (
          metric.lastFailureAt &&
          metric.lastFailureAt >
            target.lastFailureAt
        )
      ) {
        target.lastFailureAt =
          metric.lastFailureAt;

        target.lastError =
          metric.lastError;
      }
    }
  }

  const metrics =
    Array.from(
      combined.values()
    )
      .map(metric => ({
        name:
          metric.name,

        count:
          metric.count,

        completed:
          metric.completed,

        failed:
          metric.failed,

        slow:
          metric.slow,

        totalMs:
          rounded(
            metric.totalMs,
            3
          ),

        averageMs:
          metric.count > 0
            ? rounded(
                metric.totalMs /
                metric.count,
                3
              )
            : 0,

        minimumMs:
          metric.minimumMs === null
            ? null
            : rounded(
                metric.minimumMs,
                3
              ),

        maximumMs:
          rounded(
            metric.maximumMs,
            3
          ),

        latestMs:
          rounded(
            metric.latestMs,
            3
          ),

        p50Ms:
          metric.count > 0
            ? rounded(
                metric
                  .p50WeightedTotal /
                metric.count,
                3
              )
            : 0,

        p95Ms:
          metric.count > 0
            ? rounded(
                metric
                  .p95WeightedTotal /
                metric.count,
                3
              )
            : 0,

        p99Ms:
          metric.count > 0
            ? rounded(
                metric
                  .p99WeightedTotal /
                metric.count,
                3
              )
            : 0,

        firstObservedAt:
          metric.firstObservedAt,

        lastObservedAt:
          metric.lastObservedAt,

        lastFailureAt:
          metric.lastFailureAt,

        lastError:
          metric.lastError
      }))
      .sort(
        (left, right) =>
          right.totalMs -
          left.totalMs
      );

  return {
    ok: true,
    type:
      "MILES_RUNTIME_PROFILE",
    build:
      "BUILD049",
    generatedAt:
      nowIso(),
    root:
      ROOT,
    processCount:
      processes.length,
    processes,
    totals: {
      operations:
        totals.operations,
      completed:
        totals.completed,
      failed:
        totals.failed,
      slow:
        totals.slow,
      totalDurationMs:
        rounded(
          totals.totalDurationMs,
          3
        ),
      averageDurationMs:
        totals.operations > 0
          ? rounded(
              totals
                .totalDurationMs /
              totals.operations,
              3
            )
          : 0
    },
    metrics,
    slowOperations:
      slowOperations
        .sort(
          (left, right) =>
            Number(
              right.durationMs ||
              0
            ) -
            Number(
              left.durationMs ||
              0
            )
        )
        .slice(
          0,
          100
        ),
    recentFailures:
      recentFailures
        .sort(
          (left, right) =>
            String(
              right.finishedAt ||
              ""
            ).localeCompare(
              String(
                left.finishedAt ||
                ""
              )
            )
        )
        .slice(
          0,
          100
        )
  };
}

/* ============================================================
   PERSISTENCE
============================================================ */

function flushProfile() {
  if (
    !PROFILE_ENABLED ||
    flushing
  ) {
    return;
  }

  flushing = true;

  try {
    ensureDirectory(
      OUTPUT_DIR
    );

    const currentProcess =
      processSnapshot();

    writeJsonAtomic(
      PROCESS_FILE,
      currentProcess
    );

    const processFiles =
      fs
        .readdirSync(
          OUTPUT_DIR
        )
        .filter(file =>
          /^runtime_profile_process_\d+\.json$/i.test(
            file
          )
        )
        .map(file =>
          path.join(
            OUTPUT_DIR,
            file
          )
        );

    const profiles = [];

    for (
      const file of processFiles
    ) {
      const profile =
        readJson(
          file,
          null
        );

      if (!profile) {
        continue;
      }

      const generatedTime =
        Date.parse(
          profile.generatedAt ||
          ""
        );

      if (
        Number.isFinite(
          generatedTime
        ) &&
        Date.now() -
          generatedTime >
          24 * 60 * 60 * 1000
      ) {
        try {
          fs.unlinkSync(file);
        } catch {
          // Old profiler file cleanup is optional.
        }

        continue;
      }

      profiles.push(
        profile
      );
    }

    const merged =
      mergeProcessProfiles(
        profiles
      );

    writeJsonAtomic(
      OUTPUT_FILE,
      merged
    );
  } catch {
    // Telemetry persistence must never stop MILES.
  } finally {
    flushing = false;
  }
}

/* ============================================================
   LIFECYCLE
============================================================ */

function startProfiler() {
  if (!PROFILE_ENABLED) {
    return;
  }

  ensureDirectory(
    OUTPUT_DIR
  );

  console.log(
    `[MILES PROFILE] BUILD049 telemetry enabled for PID ${process.pid}.`
  );

  console.log(
    `[MILES PROFILE] Output: ${OUTPUT_FILE}`
  );

  flushProfile();

  flushTimer =
    setInterval(
      flushProfile,
      FLUSH_INTERVAL_MS
    );

  if (
    typeof flushTimer.unref ===
    "function"
  ) {
    flushTimer.unref();
  }
}

function shutdownProfiler() {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  if (flushTimer) {
    clearInterval(
      flushTimer
    );

    flushTimer = null;
  }

  flushProfile();
}

process.once(
  "beforeExit",
  shutdownProfiler
);

process.once(
  "exit",
  shutdownProfiler
);

process.once(
  "SIGINT",
  () => {
    shutdownProfiler();
  }
);

process.once(
  "SIGTERM",
  () => {
    shutdownProfiler();
  }
);

process.on(
  "uncaughtExceptionMonitor",
  error => {
    try {
      state.recentFailures.unshift({
        name:
          "PROCESS_UNCAUGHT_EXCEPTION",
        startedAt:
          null,
        finishedAt:
          nowIso(),
        durationMs:
          0,
        error:
          safeErrorMessage(error),
        metadata:
          null
      });

      state.recentFailures =
        state.recentFailures.slice(
          0,
          50
        );

      flushProfile();
    } catch {
      // Never interfere with the original error.
    }
  }
);

process.on(
  "unhandledRejection",
  reason => {
    try {
      state.recentFailures.unshift({
        name:
          "PROCESS_UNHANDLED_REJECTION",
        startedAt:
          null,
        finishedAt:
          nowIso(),
        durationMs:
          0,
        error:
          safeErrorMessage(reason),
        metadata:
          null
      });

      state.recentFailures =
        state.recentFailures.slice(
          0,
          50
        );

      flushProfile();
    } catch {
      // Never interfere with application behavior.
    }
  }
);

startProfiler();

module.exports = {
  flushProfile,
  processSnapshot,
  outputFile:
    OUTPUT_FILE,
  processFile:
    PROCESS_FILE
};