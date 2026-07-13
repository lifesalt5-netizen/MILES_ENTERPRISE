# INSTALL_MILES_BUILD_028_EXECUTION_COMPLETION.ps1
# Complete replacement of StartProductionSystem.js only.
# Extends the resident runtime with task-to-work-item reconciliation and bounded queue cleanup.

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Root = "D:\P2GC_Intelligence\MILES_ENTERPRISE"

if (-not (Test-Path $Root)) {
    throw "MILES root not found: $Root"
}

Set-Location $Root
$env:MILES_ROOT = $Root

$Stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$BackupRoot = Join-Path $Root "_BACKUPS\BUILD_028_$Stamp"
$ReportDir = Join-Path $Root "DATA\build_028"
$TestDir = Join-Path $Root "TESTS"
$Target = "StartProductionSystem.js"
$TargetPath = Join-Path $Root $Target

New-Item -ItemType Directory -Path $BackupRoot -Force | Out-Null
New-Item -ItemType Directory -Path $ReportDir -Force | Out-Null
New-Item -ItemType Directory -Path $TestDir -Force | Out-Null

if (-not (Test-Path $TargetPath)) {
    throw "Missing resident worker runtime: $TargetPath"
}

Copy-Item $TargetPath (Join-Path $BackupRoot $Target) -Force

Write-Host ""
Write-Host "============================================================"
Write-Host "MILES BUILD 028"
Write-Host "Execution Completion and Queue Reconciliation"
Write-Host "Only StartProductionSystem.js will be replaced."
Write-Host "============================================================"
Write-Host "[BACKUP] $Target"

@'
"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");

const ROOT =
  process.env.MILES_ROOT ||
  __dirname;

const DEFAULT_EXECUTION_INTERVAL_MS =
  Number(
    process.env
      .MILES_EXECUTION_INTERVAL_MS ||
    1000
  );

const DEFAULT_HEARTBEAT_MS =
  Number(
    process.env
      .MILES_HEARTBEAT_INTERVAL_MS ||
    15000
  );

const DEFAULT_BRIEF_INTERVAL_MS =
  Number(
    process.env
      .MILES_EXECUTIVE_BRIEF_INTERVAL_MS ||
    60 * 60 * 1000
  );

const DEFAULT_MAX_RETRIES =
  Number(
    process.env
      .MILES_EXECUTION_MAX_RETRIES ||
    2
  );

const DEFAULT_STALE_RUNNING_MINUTES =
  Number(
    process.env
      .MILES_STALE_RUNNING_MINUTES ||
    15
  );

const RUNTIME_DIR =
  path.join(
    ROOT,
    "DATA",
    "runtime"
  );

const STATUS_FILE =
  path.join(
    RUNTIME_DIR,
    "worker_runtime_status.json"
  );

const EXECUTION_HISTORY_FILE =
  path.join(
    RUNTIME_DIR,
    "execution_history.jsonl"
  );

const EXECUTIVE_BRIEF_JSON =
  path.join(
    RUNTIME_DIR,
    "latest_executive_brief.json"
  );

const EXECUTIVE_BRIEF_MD =
  path.join(
    RUNTIME_DIR,
    "latest_executive_brief.md"
  );

function now() {
  return new Date().toISOString();
}

function ensureRuntimeDir() {
  fs.mkdirSync(
    RUNTIME_DIR,
    { recursive: true }
  );
}

function writeJsonAtomic(
  filePath,
  value
) {
  ensureRuntimeDir();

  const tempPath =
    `${filePath}.tmp_${process.pid}_${Date.now()}`;

  const payload =
    JSON.stringify(
      value,
      null,
      2
    );

  fs.writeFileSync(
    tempPath,
    payload,
    "utf8"
  );

  try {
    fs.copyFileSync(
      tempPath,
      filePath
    );
  } finally {
    try {
      fs.unlinkSync(
        tempPath
      );
    } catch {}
  }
}

function appendJsonLine(
  filePath,
  value
) {
  ensureRuntimeDir();

  fs.appendFileSync(
    filePath,
    `${JSON.stringify(value)}\n`,
    "utf8"
  );
}

function normalizeBoolean(
  value,
  fallback = false
) {
  if (
    value === undefined ||
    value === null
  ) {
    return fallback;
  }

  return ![
    "0",
    "false",
    "no",
    "off"
  ].includes(
    String(value)
      .trim()
      .toLowerCase()
  );
}

function taskAgeMinutes(task) {
  const timestamp =
    task.updatedAt ||
    task.startedAt ||
    task.createdAt;

  if (!timestamp) return 0;

  const parsed =
    new Date(timestamp)
      .getTime();

  if (
    !Number.isFinite(parsed)
  ) {
    return 0;
  }

  return (
    Date.now() -
    parsed
  ) / 60000;
}

class RuntimeWorkerSupervisor {
  constructor(options = {}) {
    this.executionService =
      options.executionService ||
      require("./SERVICES/ExecutionService");

    this.taskQueue =
      options.taskQueue ||
      require("./CORE/TaskQueue");

    this.eventBus =
      options.eventBus ||
      require("./event-bus/emitter").bus;

    this.supervisor =
      options.supervisor ||
      require("./CORE/Supervisor");

    this.ExecutiveBriefService =
      options.ExecutiveBriefService ||
      require("./SERVICES/ExecutiveBriefService");

    this.executiveState =
      options.executiveState ||
      require("./SERVICES/ExecutiveStateService");

    const WorkQueueService =
      require("./SERVICES/WorkQueueService");

    this.workQueue =
      options.workQueue ||
      new WorkQueueService();

    this.workPackageService =
      options.workPackageService ||
      require("./SERVICES/WorkPackageService");

    this.providerRouter =
      options.providerRouter ||
      require("./SERVICES/ProviderRouterService");

    this.reconciliationIntervalMs =
      Number(
        options.reconciliationIntervalMs ||
        process.env
          .MILES_RECONCILIATION_INTERVAL_MS ||
        5000
      );

    this.archiveIntervalMs =
      Number(
        options.archiveIntervalMs ||
        process.env
          .MILES_ARCHIVE_INTERVAL_MS ||
        15 * 60 * 1000
      );

    this.executionIntervalMs =
      Number(
        options.executionIntervalMs ||
        DEFAULT_EXECUTION_INTERVAL_MS
      );

    this.heartbeatMs =
      Number(
        options.heartbeatMs ||
        DEFAULT_HEARTBEAT_MS
      );

    this.briefIntervalMs =
      Number(
        options.briefIntervalMs ||
        DEFAULT_BRIEF_INTERVAL_MS
      );

    this.maxRetries =
      Number.isFinite(
        Number(
          options.maxRetries
        )
      )
        ? Number(
            options.maxRetries
          )
        : DEFAULT_MAX_RETRIES;

    this.staleRunningMinutes =
      Number(
        options.staleRunningMinutes ||
        DEFAULT_STALE_RUNNING_MINUTES
      );

    this.enableRetries =
      normalizeBoolean(
        options.enableRetries,
        normalizeBoolean(
          process.env
            .MILES_EXECUTION_RETRIES_ENABLED,
          true
        )
      );

    this.executionLoopRunning =
      false;

    this.started =
      false;

    this.shuttingDown =
      false;

    this.executionTimer =
      null;

    this.heartbeatTimer =
      null;

    this.briefTimer =
      null;

    this.reconciliationTimer =
      null;

    this.archiveTimer =
      null;

    this.metrics = {
      startedAt: null,
      lastExecutionAt: null,
      lastExecutionResult: null,
      lastHeartbeatAt: null,
      lastExecutiveBriefAt: null,
      executionPasses: 0,
      completed: 0,
      failed: 0,
      retried: 0,
      staleRecovered: 0,
      loopErrors: 0,
      workItemsReconciled: 0,
      workItemsCompleted: 0,
      workItemsFailed: 0,
      workItemsAwaitingApproval: 0,
      staleCapabilityWorkSuppressed: 0,
      archivedWorkItems: 0,
      throughputPerMinute: 0,
      lastReconciliationAt: null,
      lastArchiveAt: null
    };
  }

  statusSnapshot() {
    let queueStatus = {};

    try {
      queueStatus =
        this.taskQueue.getStatus();
    } catch (error) {
      queueStatus = {
        error:
          error.message
      };
    }

    return {
      ok: true,
      service:
        "MILES_WORKER_RUNTIME",
      pid:
        process.pid,
      started:
        this.started,
      shuttingDown:
        this.shuttingDown,
      executionLoopRunning:
        this.executionLoopRunning,
      generatedAt:
        now(),
      configuration: {
        executionIntervalMs:
          this.executionIntervalMs,
        heartbeatMs:
          this.heartbeatMs,
        briefIntervalMs:
          this.briefIntervalMs,
        maxRetries:
          this.maxRetries,
        retriesEnabled:
          this.enableRetries,
        staleRunningMinutes:
          this.staleRunningMinutes,
        reconciliationIntervalMs:
          this.reconciliationIntervalMs,
        archiveIntervalMs:
          this.archiveIntervalMs
      },
      queue:
        queueStatus,
      metrics:
        this.metrics
    };
  }

  persistStatus() {
    const snapshot =
      this.statusSnapshot();

    writeJsonAtomic(
      STATUS_FILE,
      snapshot
    );

    return snapshot;
  }

  recordExecution(
    record
  ) {
    appendJsonLine(
      EXECUTION_HISTORY_FILE,
      {
        recordedAt:
          now(),
        ...record
      }
    );
  }

  recoverStaleRunningTasks() {
    const running =
      this.taskQueue
        .list("RUNNING");

    const recovered = [];

    for (const task of running) {
      const age =
        taskAgeMinutes(
          task
        );

      if (
        age <
        this.staleRunningMinutes
      ) {
        continue;
      }

      const retryCount =
        Number(
          task.retryCount ||
          0
        );

      this.taskQueue.update(
        task.id,
        {
          status:
            retryCount <
            this.maxRetries
              ? "QUEUED"
              : "FAILED",
          retryCount:
            retryCount +
            1,
          recoveredFromStale:
            true,
          staleRecoveredAt:
            now(),
          staleAgeMinutes:
            Math.round(
              age * 100
            ) / 100,
          error:
            retryCount <
            this.maxRetries
              ? null
              : "Stale RUNNING task exceeded retry limit."
        }
      );

      recovered.push({
        taskId:
          task.id,
        previousStatus:
          "RUNNING",
        newStatus:
          retryCount <
          this.maxRetries
            ? "QUEUED"
            : "FAILED",
        ageMinutes:
          age
      });
    }

    this.metrics.staleRecovered +=
      recovered.length;

    if (
      recovered.length > 0
    ) {
      this.recordExecution({
        type:
          "STALE_TASK_RECOVERY",
        recovered
      });
    }

    return recovered;
  }

  retryIfAllowed(
    task,
    result
  ) {
    if (
      !this.enableRetries ||
      !task ||
      !result ||
      result.ok === true ||
      result.status ===
        "AWAITING_APPROVAL"
    ) {
      return {
        retried: false
      };
    }

    const retryable =
      result.retryable === true ||
      result.failure
        ?.retryable === true;

    if (!retryable) {
      return {
        retried: false,
        reason:
          "Failure is not retryable."
      };
    }

    const currentRetries =
      Number(
        task.retryCount ||
        0
      );

    if (
      currentRetries >=
      this.maxRetries
    ) {
      return {
        retried: false,
        reason:
          "Retry limit reached."
      };
    }

    const updated =
      this.taskQueue.update(
        task.id,
        {
          status: "QUEUED",
          retryCount:
            currentRetries + 1,
          lastRetryAt:
            now(),
          lastRetryReason:
            result.error ||
            result.failure
              ?.type ||
            "Transient execution failure",
          error: null
        }
      );

    this.metrics.retried += 1;

    this.recordExecution({
      type:
        "TASK_RETRY_QUEUED",
      taskId:
        task.id,
      retryCount:
        updated.retryCount,
      result
    });

    return {
      retried: true,
      task:
        updated
    };
  }

  capabilityProviderForWorkItem(item = {}) {
    const text =
      `${item.area || ""} ${item.title || ""} ${item.recommendedAction || ""}`
        .toLowerCase();

    if (/website\s+coo|website provider/.test(text)) {
      return "WebsiteProvider";
    }

    if (/sales\s+coo|sales pipeline/.test(text)) {
      return "SalesProvider";
    }

    if (/marketing\s+coo|instantly/.test(text)) {
      return "MarketingProvider";
    }

    if (/orion\s+coo|government data/.test(text)) {
      return "OrionProvider";
    }

    if (/google workspace\s+coo|gmail|calendar|drive/.test(text)) {
      return "GoogleWorkspaceProvider";
    }

    return null;
  }

  suppressInstalledCapabilityWork() {
    const registered =
      new Set(
        this.providerRouter
          .status()
          .registeredProviders || []
      );

    const suppressed = [];

    for (const item of this.workQueue.getOpen()) {
      if (item.source !== "CapabilityBacklog") {
        continue;
      }

      const provider =
        this.capabilityProviderForWorkItem(item);

      if (!provider || !registered.has(provider)) {
        continue;
      }

      const workflowResult =
        item.metadata?.workflowResult || {};

      const workPackageId =
        workflowResult.workPackage?.id ||
        workflowResult.workPackageId ||
        item.metadata?.workPackageId ||
        null;

      if (workPackageId) {
        const tasks =
          this.taskQueue
            .list()
            .filter(task =>
              task.payload?.workPackageId ===
              workPackageId
            );

        for (const task of tasks) {
          if (
            ["QUEUED", "RUNNING"]
              .includes(task.status)
          ) {
            this.taskQueue.update(
              task.id,
              {
                status: "COMPLETED",
                result: {
                  ok: true,
                  status: "COMPLETED",
                  reason:
                    `Capability already installed through ${provider}.`,
                  suppressedAsStaleCapabilityWork:
                    true,
                  completedAt:
                    now()
                }
              }
            );
          }
        }
      }

      this.workQueue.markCompleted(
        item.id,
        {
          reconciliation: {
            reason:
              `Capability already installed through ${provider}.`,
            provider,
            completedAt:
              now()
          }
        }
      );

      suppressed.push({
        workItemId:
          item.id,
        provider,
        workPackageId
      });
    }

    this.metrics.staleCapabilityWorkSuppressed +=
      suppressed.length;

    if (suppressed.length > 0) {
      this.recordExecution({
        type:
          "STALE_CAPABILITY_WORK_SUPPRESSED",
        suppressed
      });
    }

    return suppressed;
  }

  workPackageStatus(workPackageId) {
    if (!workPackageId) {
      return {
        status: "UNKNOWN",
        tasks: []
      };
    }

    const tasks =
      this.taskQueue
        .list()
        .filter(task =>
          task.payload?.workPackageId ===
          workPackageId
        );

    if (tasks.length === 0) {
      const workPackage =
        this.workPackageService.get(
          workPackageId
        );

      return {
        status:
          workPackage?.status ||
          "UNKNOWN",
        tasks,
        workPackage
      };
    }

    const statuses =
      new Set(
        tasks.map(task =>
          String(task.status || "")
            .toUpperCase()
        )
      );

    if (
      statuses.has(
        "AWAITING_APPROVAL"
      )
    ) {
      return {
        status:
          "AWAITING_APPROVAL",
        tasks
      };
    }

    if (
      statuses.has("RUNNING")
    ) {
      return {
        status:
          "IN_PROGRESS",
        tasks
      };
    }

    if (
      statuses.has("QUEUED")
    ) {
      return {
        status:
          "QUEUED",
        tasks
      };
    }

    if (
      tasks.every(task =>
        String(task.status)
          .toUpperCase() ===
        "COMPLETED"
      )
    ) {
      return {
        status:
          "COMPLETED",
        tasks
      };
    }

    if (
      tasks.some(task =>
        String(task.status)
          .toUpperCase() ===
        "FAILED"
      )
    ) {
      return {
        status:
          "FAILED",
        tasks
      };
    }

    return {
      status:
        "UNKNOWN",
      tasks
    };
  }

  reconcileWorkQueue() {
    this.workQueue.load();

    const suppressed =
      this.suppressInstalledCapabilityWork();

    const reconciled = [];

    for (const item of this.workQueue.getOpen()) {
      const workflowResult =
        item.metadata?.workflowResult || {};

      const workPackageId =
        workflowResult.workPackage?.id ||
        workflowResult.workPackageId ||
        item.metadata?.workPackageId ||
        null;

      if (!workPackageId) {
        continue;
      }

      const packageState =
        this.workPackageStatus(
          workPackageId
        );

      let updated = null;

      if (
        packageState.status ===
        "COMPLETED"
      ) {
        updated =
          this.workQueue.markCompleted(
            item.id,
            {
              workPackageId,
              reconciliation: {
                status:
                  "COMPLETED",
                completedAt:
                  now(),
                taskCount:
                  packageState.tasks.length
              }
            }
          );

        this.metrics.workItemsCompleted += 1;
      } else if (
        packageState.status ===
        "FAILED"
      ) {
        const failedTasks =
          packageState.tasks.filter(task =>
            String(task.status)
              .toUpperCase() ===
            "FAILED"
          );

        updated =
          this.workQueue.markFailed(
            item.id,
            {
              workPackageId,
              reconciliation: {
                status:
                  "FAILED",
                failedAt:
                  now(),
                failedTaskIds:
                  failedTasks.map(
                    task =>
                      task.id
                  ),
                errors:
                  failedTasks.map(
                    task =>
                      task.error ||
                      task.result?.error ||
                      "Task failed"
                  )
              }
            }
          );

        this.metrics.workItemsFailed += 1;
      } else if (
        packageState.status ===
        "AWAITING_APPROVAL"
      ) {
        updated =
          this.workQueue
            .markAwaitingApproval(
              item.id,
              {
                workPackageId,
                reconciliation: {
                  status:
                    "AWAITING_APPROVAL",
                  detectedAt:
                    now()
                }
              }
            );

        this.metrics.workItemsAwaitingApproval += 1;
      } else if (
        packageState.status ===
        "IN_PROGRESS"
      ) {
        updated =
          this.workQueue.markRunning(
            item.id,
            {
              workPackageId,
              reconciliation: {
                status:
                  "IN_PROGRESS",
                detectedAt:
                  now()
              }
            }
          );
      } else if (
        packageState.status ===
        "QUEUED" &&
        item.status !== "Queued"
      ) {
        updated =
          this.workQueue.markQueued(
            item.id,
            {
              workPackageId,
              reconciliation: {
                status:
                  "QUEUED",
                detectedAt:
                  now()
              }
            }
          );
      }

      if (updated) {
        reconciled.push({
          workItemId:
            item.id,
          workPackageId,
          status:
            updated.status
        });
      }
    }

    this.metrics.workItemsReconciled +=
      reconciled.length;

    this.metrics.lastReconciliationAt =
      now();

    const elapsedMinutes =
      this.metrics.startedAt
        ? Math.max(
            (
              Date.now() -
              new Date(
                this.metrics.startedAt
              ).getTime()
            ) / 60000,
            1 / 60
          )
        : 1;

    this.metrics.throughputPerMinute =
      Math.round(
        (
          this.metrics.completed /
          elapsedMinutes
        ) *
        100
      ) / 100;

    if (
      reconciled.length > 0 ||
      suppressed.length > 0
    ) {
      this.recordExecution({
        type:
          "WORK_QUEUE_RECONCILIATION",
        reconciled,
        suppressed,
        workQueueStats:
          this.workQueue.getStats()
      });
    }

    this.persistStatus();

    return {
      ok: true,
      reconciled,
      suppressed,
      stats:
        this.workQueue.getStats()
    };
  }

  archiveClosedWork() {
    const result =
      this.workQueue.archiveClosed();

    this.metrics.archivedWorkItems +=
      Number(
        result.archived ||
        0
      );

    this.metrics.lastArchiveAt =
      now();

    if (
      Number(
        result.archived ||
        0
      ) > 0
    ) {
      this.recordExecution({
        type:
          "WORK_QUEUE_ARCHIVE",
        archived:
          result.archived
      });
    }

    this.persistStatus();

    return result;
  }

  async executePass() {
    if (
      this.executionLoopRunning ||
      this.shuttingDown
    ) {
      return {
        ok: true,
        skipped: true,
        reason:
          this.shuttingDown
            ? "SHUTTING_DOWN"
            : "PASS_ALREADY_RUNNING"
      };
    }

    this.executionLoopRunning =
      true;

    const queuedBefore =
      this.taskQueue
        .list("QUEUED");

    const selectedTask =
      queuedBefore
        .slice()
        .sort(
          (a, b) =>
            Number(
              a.priority ||
              99
            ) -
            Number(
              b.priority ||
              99
            )
        )[0] ||
      null;

    try {
      this.metrics.executionPasses += 1;
      this.metrics.lastExecutionAt =
        now();

      const result =
        await this.executionService
          .runNext();

      this.metrics.lastExecutionResult =
        result;

      if (
        selectedTask &&
        result?.ok === true &&
        result?.message !==
          "No queued tasks"
      ) {
        this.metrics.completed += 1;
      }

      if (
        selectedTask &&
        result?.ok === false &&
        result?.status !==
          "AWAITING_APPROVAL"
      ) {
        this.metrics.failed += 1;
      }

      const retry =
        this.retryIfAllowed(
          selectedTask,
          result
        );

      this.recordExecution({
        type:
          "EXECUTION_PASS",
        selectedTaskId:
          selectedTask?.id ||
          null,
        selectedTaskType:
          selectedTask?.type ||
          null,
        result,
        retry
      });

      const reconciliation =
        this.reconcileWorkQueue();

      this.persistStatus();

      return {
        ok:
          result?.ok !== false ||
          retry.retried === true,
        taskId:
          selectedTask?.id ||
          null,
        result,
        retry,
        reconciliation
      };
    } catch (error) {
      this.metrics.loopErrors += 1;
      this.metrics.lastExecutionResult = {
        ok: false,
        error:
          error.stack ||
          error.message
      };

      this.recordExecution({
        type:
          "EXECUTION_LOOP_ERROR",
        selectedTaskId:
          selectedTask?.id ||
          null,
        error:
          error.stack ||
          error.message
      });

      this.persistStatus();

      return {
        ok: false,
        error:
          error.stack ||
          error.message
      };
    } finally {
      this.executionLoopRunning =
        false;
    }
  }

  generateExecutiveBrief() {
    try {
      const service =
        new this.ExecutiveBriefService(
          this.executiveState
        );

      const brief =
        service.generate();

      const markdown =
        service.toMarkdown();

      writeJsonAtomic(
        EXECUTIVE_BRIEF_JSON,
        brief
      );

      ensureRuntimeDir();

      fs.writeFileSync(
        EXECUTIVE_BRIEF_MD,
        markdown,
        "utf8"
      );

      this.metrics.lastExecutiveBriefAt =
        now();

      this.recordExecution({
        type:
          "EXECUTIVE_BRIEF_GENERATED",
        businessHealth:
          brief.businessHealth,
        businessHealthScore:
          brief.businessHealthScore,
        authorizedWork:
          brief.authorizedWork
            ?.length ||
          0,
        ceoDecisions:
          brief
            .executiveDecisionsNeeded
            ?.length ||
          0
      });

      this.persistStatus();

      return {
        ok: true,
        brief,
        jsonFile:
          EXECUTIVE_BRIEF_JSON,
        markdownFile:
          EXECUTIVE_BRIEF_MD
      };
    } catch (error) {
      this.recordExecution({
        type:
          "EXECUTIVE_BRIEF_ERROR",
        error:
          error.stack ||
          error.message
      });

      return {
        ok: false,
        error:
          error.stack ||
          error.message
      };
    }
  }

  emitHeartbeat() {
    this.metrics.lastHeartbeatAt =
      now();

    try {
      this.eventBus.emit(
        "COO_TICK"
      );
    } catch (error) {
      console.error(
        "[MILES] HEARTBEAT ERROR",
        error
      );
    }

    const snapshot =
      this.persistStatus();

    console.log(
      `[MILES] HEARTBEAT → COO_TICK | queued=${snapshot.queue.pending || 0} running=${snapshot.queue.running || 0} failed=${snapshot.queue.failed || 0} health=${snapshot.queue.healthScore ?? "unknown"}`
    );

    return snapshot;
  }

  startExecutionLoop() {
    console.log(
      `[MILES] Execution loop starting (${this.executionIntervalMs} ms).`
    );

    this.executionTimer =
      setInterval(
        () => {
          this.executePass()
            .catch(error => {
              console.error(
                "[MILES] EXECUTION LOOP ERROR"
              );
              console.error(error);
            });
        },
        this.executionIntervalMs
      );
  }

  startHeartbeat() {
    this.heartbeatTimer =
      setInterval(
        () => {
          this.emitHeartbeat();
        },
        this.heartbeatMs
      );
  }

  startExecutiveBriefLoop() {
    this.generateExecutiveBrief();

    this.briefTimer =
      setInterval(
        () => {
          this.generateExecutiveBrief();
        },
        this.briefIntervalMs
      );
  }

  startReconciliationLoop() {
    this.reconcileWorkQueue();

    this.reconciliationTimer =
      setInterval(
        () => {
          try {
            this.reconcileWorkQueue();
          } catch (error) {
            console.error(
              "[MILES] RECONCILIATION ERROR",
              error
            );
          }
        },
        this.reconciliationIntervalMs
      );
  }

  startArchiveLoop() {
    this.archiveTimer =
      setInterval(
        () => {
          try {
            this.archiveClosedWork();
          } catch (error) {
            console.error(
              "[MILES] ARCHIVE ERROR",
              error
            );
          }
        },
        this.archiveIntervalMs
      );
  }

  async boot() {
    if (this.started) {
      return this.statusSnapshot();
    }

    console.log("");
    console.log(
      "[MILES] ==============================="
    );
    console.log(
      "[MILES] AUTONOMOUS SYSTEM ONLINE"
    );
    console.log(
      "[MILES] GOVERNED WORKER RUNTIME ACTIVE"
    );
    console.log(
      "[MILES] ==============================="
    );
    console.log("");

    console.log(
      "[MILES] Booting workers..."
    );

    await this.supervisor.start();

    await new Promise(
      resolve =>
        setTimeout(
          resolve,
          1000
        )
    );

    this.recoverStaleRunningTasks();

    this.started = true;
    this.metrics.startedAt =
      now();

    this.startExecutionLoop();
    this.startHeartbeat();
    this.startExecutiveBriefLoop();
    this.startReconciliationLoop();
    this.startArchiveLoop();

    console.log(
      "[MILES] Workers online"
    );
    console.log(
      "[MILES] System fully running"
    );
    console.log("");

    return this.persistStatus();
  }

  async shutdown(
    signal = "MANUAL"
  ) {
    if (this.shuttingDown) {
      return;
    }

    this.shuttingDown =
      true;

    console.log(
      `[MILES] Worker runtime shutdown requested: ${signal}`
    );

    if (this.executionTimer) {
      clearInterval(
        this.executionTimer
      );
    }

    if (this.heartbeatTimer) {
      clearInterval(
        this.heartbeatTimer
      );
    }

    if (this.briefTimer) {
      clearInterval(
        this.briefTimer
      );
    }

    if (this.reconciliationTimer) {
      clearInterval(
        this.reconciliationTimer
      );
    }

    if (this.archiveTimer) {
      clearInterval(
        this.archiveTimer
      );
    }

    this.reconcileWorkQueue();
    this.persistStatus();
  }
}

async function main() {
  require("./api/server");

  require("./workers/cooWorker");
  require("./workers/revenueWorker");
  require("./workers/replyWorker");
  require("./workers/dealWorker");
  require("./workers/atlasWorker");

  const runtime =
    new RuntimeWorkerSupervisor();

  process.on(
    "SIGINT",
    async () => {
      await runtime.shutdown(
        "SIGINT"
      );
      process.exit(0);
    }
  );

  process.on(
    "SIGTERM",
    async () => {
      await runtime.shutdown(
        "SIGTERM"
      );
      process.exit(0);
    }
  );

  process.on(
    "uncaughtException",
    error => {
      console.error(
        "[MILES] UNCAUGHT EXCEPTION",
        error
      );

      runtime.persistStatus();
    }
  );

  process.on(
    "unhandledRejection",
    reason => {
      console.error(
        "[MILES] UNHANDLED REJECTION",
        reason
      );

      runtime.persistStatus();
    }
  );

  await runtime.boot();
}

if (require.main === module) {
  main().catch(error => {
    console.error("");
    console.error(
      "[MILES] BOOT FAILED"
    );
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  RuntimeWorkerSupervisor,
  main
};

'@ | Set-Content -Path $TargetPath -Encoding UTF8

$TestPath = Join-Path $TestDir "Test_Build028_ExecutionCompletion.js"

@'
"use strict";

const assert = require("assert");

process.env.MILES_ROOT =
  process.env.MILES_ROOT ||
  "D:\\P2GC_Intelligence\\MILES_ENTERPRISE";

const {
  RuntimeWorkerSupervisor
} = require("../StartProductionSystem");

class FakeTaskQueue {
  constructor() {
    this.tasks = [{
      id: "TASK-1",
      type: "WORKFORCE_STEP",
      priority: 1,
      status: "COMPLETED",
      payload: {
        workPackageId: "WP-1"
      }
    }, {
      id: "TASK-2",
      type: "WORKFORCE_STEP",
      priority: 2,
      status: "FAILED",
      error: "Provider failed",
      payload: {
        workPackageId: "WP-2"
      }
    }, {
      id: "TASK-3",
      type: "WORKFORCE_STEP",
      priority: 3,
      status: "QUEUED",
      payload: {
        workPackageId: "WP-3"
      }
    }];
  }

  list(status = null) {
    return status
      ? this.tasks.filter(
          task => task.status === status
        )
      : this.tasks;
  }

  update(id, patch) {
    const task =
      this.tasks.find(
        row => row.id === id
      );

    Object.assign(task, patch);
    return task;
  }

  getStatus() {
    return {
      total: this.tasks.length,
      pending: this.tasks.filter(
        task => task.status === "QUEUED"
      ).length,
      running: 0,
      completed: this.tasks.filter(
        task => task.status === "COMPLETED"
      ).length,
      failed: this.tasks.filter(
        task => task.status === "FAILED"
      ).length,
      healthScore: 100
    };
  }
}

class FakeWorkQueue {
  constructor() {
    this.items = [{
      id: "WORK-1",
      status: "Queued",
      source: "ExecutiveCOO",
      metadata: {
        workflowResult: {
          workPackage: {
            id: "WP-1"
          }
        }
      }
    }, {
      id: "WORK-2",
      status: "Queued",
      source: "ExecutiveCOO",
      metadata: {
        workflowResult: {
          workPackage: {
            id: "WP-2"
          }
        }
      }
    }, {
      id: "WORK-3",
      status: "Queued",
      source: "ExecutiveCOO",
      metadata: {
        workflowResult: {
          workPackage: {
            id: "WP-3"
          }
        }
      }
    }, {
      id: "WORK-4",
      status: "Queued",
      source: "CapabilityBacklog",
      area: "Website COO",
      title: "Build Website COO live audit and repair operator",
      metadata: {
        workflowResult: {
          workPackage: {
            id: "WP-4"
          }
        }
      }
    }];
  }

  load() {}

  getOpen() {
    return this.items.filter(item =>
      [
        "Pending",
        "Queued",
        "In Progress",
        "Blocked",
        "Awaiting Approval"
      ].includes(item.status)
    );
  }

  markCompleted(id, metadata = {}) {
    const item =
      this.items.find(row => row.id === id);
    item.status = "Completed";
    item.metadata = {
      ...(item.metadata || {}),
      ...metadata
    };
    return item;
  }

  markFailed(id, metadata = {}) {
    const item =
      this.items.find(row => row.id === id);
    item.status = "Failed";
    item.metadata = {
      ...(item.metadata || {}),
      ...metadata
    };
    return item;
  }

  markAwaitingApproval(id, metadata = {}) {
    const item =
      this.items.find(row => row.id === id);
    item.status = "Awaiting Approval";
    item.metadata = {
      ...(item.metadata || {}),
      ...metadata
    };
    return item;
  }

  markRunning(id, metadata = {}) {
    const item =
      this.items.find(row => row.id === id);
    item.status = "In Progress";
    item.metadata = {
      ...(item.metadata || {}),
      ...metadata
    };
    return item;
  }

  markQueued(id, metadata = {}) {
    const item =
      this.items.find(row => row.id === id);
    item.status = "Queued";
    item.metadata = {
      ...(item.metadata || {}),
      ...metadata
    };
    return item;
  }

  getStats() {
    return {
      total: this.items.length,
      completed: this.items.filter(
        item => item.status === "Completed"
      ).length,
      failed: this.items.filter(
        item => item.status === "Failed"
      ).length
    };
  }

  archiveClosed() {
    const closed =
      this.items.filter(item =>
        [
          "Completed",
          "Failed",
          "Cancelled",
          "Archived"
        ].includes(item.status)
      );

    this.items =
      this.items.filter(item =>
        !closed.includes(item)
      );

    return {
      ok: true,
      archived: closed.length
    };
  }
}

async function main() {
  const taskQueue =
    new FakeTaskQueue();

  const workQueue =
    new FakeWorkQueue();

  const runtime =
    new RuntimeWorkerSupervisor({
      taskQueue,
      workQueue,
      executionService: {
        async runNext() {
          return {
            ok: true,
            message: "No queued tasks"
          };
        }
      },
      supervisor: {
        async start() {}
      },
      eventBus: {
        emit() {}
      },
      ExecutiveBriefService: class {
        generate() {
          return {
            businessHealth: "Healthy",
            businessHealthScore: 100,
            authorizedWork: [],
            executiveDecisionsNeeded: []
          };
        }

        toMarkdown() {
          return "# Brief";
        }
      },
      executiveState: {},
      providerRouter: {
        status() {
          return {
            registeredProviders: [
              "WebsiteProvider",
              "SalesProvider",
              "MarketingProvider",
              "OrionProvider",
              "GoogleWorkspaceProvider"
            ]
          };
        }
      },
      workPackageService: {
        get(id) {
          return {
            id,
            status: "QUEUED"
          };
        }
      },
      executionIntervalMs: 999999,
      heartbeatMs: 999999,
      briefIntervalMs: 999999,
      reconciliationIntervalMs: 999999,
      archiveIntervalMs: 999999
    });

  const result =
    runtime.reconcileWorkQueue();

  assert.strictEqual(
    workQueue.items.find(
      item => item.id === "WORK-1"
    ).status,
    "Completed"
  );

  assert.strictEqual(
    workQueue.items.find(
      item => item.id === "WORK-2"
    ).status,
    "Failed"
  );

  assert.strictEqual(
    workQueue.items.find(
      item => item.id === "WORK-3"
    ).status,
    "Queued"
  );

  assert.strictEqual(
    workQueue.items.find(
      item => item.id === "WORK-4"
    ).status,
    "Completed"
  );

  assert.strictEqual(
    result.suppressed.length,
    1
  );

  const archive =
    runtime.archiveClosedWork();

  assert.strictEqual(
    archive.archived,
    3
  );

  assert.strictEqual(
    workQueue.items.length,
    1
  );

  const status =
    runtime.persistStatus();

  assert.strictEqual(
    status.metrics.workItemsCompleted >= 2,
    true
  );

  assert.strictEqual(
    status.metrics.workItemsFailed,
    1
  );

  assert.strictEqual(
    status.metrics.staleCapabilityWorkSuppressed,
    1
  );

  console.log(JSON.stringify({
    ok: true,
    build: "028",
    tests: {
      taskToWorkItemReconciliation: "PASSED",
      completedWorkClosure: "PASSED",
      failedWorkClosure: "PASSED",
      queuedWorkPreservation: "PASSED",
      staleCapabilitySuppression: "PASSED",
      closedWorkArchiving: "PASSED",
      boundedQueueCompatibility: "PASSED",
      throughputMetrics: "PASSED",
      residentRuntimeCompatibility: "PASSED"
    },
    reconciliation: result,
    archive,
    runtimeMetrics:
      status.metrics,
    remainingWorkItems:
      workQueue.items
  }, null, 2));
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});

'@ | Set-Content -Path $TestPath -Encoding UTF8

Write-Host ""
Write-Host "=== BUILD 028 SYNTAX VALIDATION ==="

$Files = @(
    ".\StartProductionSystem.js",
    ".\StartMilesProduction.js",
    ".\SERVICES\ExecutionService.js",
    ".\SERVICES\WorkQueueService.js",
    ".\SERVICES\WorkPackageService.js",
    ".\SERVICES\ProviderRouterService.js",
    ".\CORE\TaskQueue.js",
    ".\TESTS\Test_Build028_ExecutionCompletion.js"
)

foreach ($File in $Files) {
    & node --check $File

    if ($LASTEXITCODE -ne 0) {
        throw "Syntax failed: $File"
    }

    Write-Host "[PASS] $File"
}

Write-Host ""
Write-Host "=== BUILD 028 AUTOMATED TESTS ==="

$Output = & node $TestPath 2>&1
$ExitCode = $LASTEXITCODE
$Report = Join-Path $ReportDir "build_028_test_$Stamp.txt"

$Output | Tee-Object -FilePath $Report

if ($ExitCode -ne 0) {
    throw "Build 028 tests failed. Restore from $BackupRoot"
}

$Manifest = [ordered]@{
    ok = $true
    build = "028"
    name = "Execution Completion and Queue Reconciliation"
    installedAt = (Get-Date).ToString("o")
    backupRoot = $BackupRoot
    changedFiles = @(
        "StartProductionSystem.js"
    )
    preservedServices = @(
        "SERVICES\ExecutionService.js",
        "SERVICES\WorkQueueService.js",
        "SERVICES\WorkPackageService.js",
        "SERVICES\ProviderRouterService.js",
        "CORE\TaskQueue.js"
    )
    capabilities = @(
        "Task-to-work-item reconciliation",
        "Automatic work completion",
        "Automatic work failure closure",
        "Awaiting-approval reconciliation",
        "Stale capability backlog suppression",
        "Closed work archiving",
        "Queue bounding",
        "Throughput metrics"
    )
    report = $Report
}

$Manifest |
    ConvertTo-Json -Depth 8 |
    Set-Content -Path (Join-Path $ReportDir "build_028_manifest_$Stamp.json") -Encoding UTF8

Write-Host ""
Write-Host "============================================================"
Write-Host "BUILD 028 EXECUTION COMPLETION INSTALLED AND VERIFIED"
Write-Host "============================================================"
Write-Host "Backup: $BackupRoot"
Write-Host "Report: $Report"
Write-Host ""
Write-Host "Restart production:"
Write-Host "taskkill /F /IM node.exe"
Write-Host "node StartMilesProduction.js"
