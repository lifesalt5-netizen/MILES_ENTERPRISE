"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const taskQueue =
  require("../CORE/TaskQueue");

const infrastructureRegistry =
  require("./InfrastructureRegistryService");

const credentialAuthority =
  require("./CredentialAuthorityService");

const healthManager =
  require("./InfrastructureHealthManagerService");

const ROOT =
  process.env.MILES_ROOT ||
  "D:\\P2GC_Intelligence\\MILES_ENTERPRISE";

const DATA_DIR =
  path.join(
    ROOT,
    "DATA",
    "autonomous_work"
  );

const STATE_FILE =
  path.join(
    DATA_DIR,
    "autonomous_work_generation_state.json"
  );

const HISTORY_FILE =
  path.join(
    DATA_DIR,
    "autonomous_work_generation_history.jsonl"
  );

const DEFAULT_INTERVAL_MS =
  positiveNumber(
    process.env
      .MILES_AUTONOMOUS_WORK_INTERVAL_MS,
    5 * 60 * 1000
  );

const DEFAULT_MAX_TASKS_PER_CYCLE =
  positiveNumber(
    process.env
      .MILES_AUTONOMOUS_WORK_MAX_TASKS_PER_CYCLE,
    20
  );

const ACTIVE_TASK_STATUSES =
  new Set([
    "QUEUED",
    "RUNNING",
    "AWAITING_APPROVAL",
    "AUTHORIZED",
    "PENDING"
  ]);

const PRIORITY = Object.freeze({
  CRITICAL: 1,
  HIGH: 2,
  MEDIUM: 3,
  LOW: 4
});

function positiveNumber(
  value,
  fallback
) {
  const parsed =
    Number(value);

  return (
    Number.isFinite(parsed) &&
    parsed > 0
  )
    ? parsed
    : fallback;
}

function ensureDir(directory) {
  fs.mkdirSync(
    directory,
    {
      recursive: true
    }
  );
}

function nowIso() {
  return new Date()
    .toISOString();
}

function safeReadJson(
  file,
  fallback = null
) {
  try {
    if (
      !fs.existsSync(file)
    ) {
      return fallback;
    }

    return JSON.parse(
      fs
        .readFileSync(
          file,
          "utf8"
        )
        .replace(
          /^\uFEFF/,
          ""
        )
    );
  } catch {
    return fallback;
  }
}

function safeWriteJson(
  file,
  value
) {
  ensureDir(
    path.dirname(file)
  );

  const temporary =
    `${file}.${process.pid}.${Date.now()}.tmp`;

  fs.writeFileSync(
    temporary,
    JSON.stringify(
      value,
      null,
      2
    ),
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
    path.dirname(
      HISTORY_FILE
    )
  );

  fs.appendFileSync(
    HISTORY_FILE,
    `${JSON.stringify(record)}\n`,
    "utf8"
  );
}

function normalizeText(value) {
  return String(
    value || ""
  )
    .trim()
    .replace(
      /\s+/g,
      " "
    );
}

function normalizeId(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(
      /[^a-z0-9_-]+/g,
      "_"
    )
    .replace(
      /^_+|_+$/g,
      ""
    )
    .slice(
      0,
      100
    );
}

function stableHash(value) {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify(value)
    )
    .digest("hex")
    .slice(
      0,
      16
    );
}

function statusUpper(value) {
  return String(
    value || ""
  )
    .trim()
    .toUpperCase();
}

function priorityFor(
  status,
  score = 0,
  category = ""
) {
  const normalized =
    statusUpper(status);

  if (
    normalized === "CRITICAL" ||
    normalized === "FAILED" ||
    normalized === "OFFLINE" ||
    Number(score) < 40
  ) {
    return PRIORITY.CRITICAL;
  }

  if (
    normalized === "DEGRADED" ||
    Number(score) < 70 ||
    category === "CREDENTIAL"
  ) {
    return PRIORITY.HIGH;
  }

  if (
    normalized === "WATCH" ||
    normalized === "WARNING" ||
    normalized === "PARTIAL"
  ) {
    return PRIORITY.MEDIUM;
  }

  return PRIORITY.LOW;
}

function priorityLabel(value) {
  for (
    const [label, number]
    of Object.entries(PRIORITY)
  ) {
    if (
      number === value
    ) {
      return label;
    }
  }

  return "LOW";
}

function actionProfile(
  infrastructureId,
  finding = {}
) {
  switch (infrastructureId) {
    case "orion":
      return {
        provider:
          "OrionProvider",

        action:
          "refresh",

        capability:
          "orion.health.refresh",

        assignedTo:
          "Allison",

        department:
          "Intelligence",

        expectedOutput:
          "Current ORION database health, freshness, record counts, and corrective recommendations.",

        verification:
          "Verify ORION health is not Critical and the infrastructure registry reflects the latest provider result.",

        safeToAutoExecute:
          true
      };

    case "instantly":
      return {
        provider:
          "MarketingProvider",

        action:
          "refresh",

        capability:
          "revenue.outbound.audit",

        assignedTo:
          "InstantlyExecutiveAdvisor",

        department:
          "Revenue Operations",

        expectedOutput:
          "Current campaign, mailbox, deliverability, segment, and lead inventory health.",

        verification:
          "Verify MarketingProvider returned current outbound metrics, exceptions, and actionable recommendations.",

        safeToAutoExecute:
          true
      };

    case "google_workspace":
      return {
        provider:
          "GoogleWorkspaceProvider",

        action:
          "auditWorkspace",

        capability:
          "google.workspace.audit",

        assignedTo:
          "GoogleWorkspaceExecutiveAdvisor",

        department:
          "Operations",

        expectedOutput:
          "Current Google Workspace account, Gmail, Calendar, and Drive health.",

        verification:
          "Verify Google Workspace accounts are registered and the provider returns a current workspace snapshot.",

        safeToAutoExecute:
          true
      };

    case "website":
      return {
        provider:
          "WebsiteProvider",

        action:
          "verifyWebsite",

        capability:
          "website.health.audit",

        assignedTo:
          "WebsiteExecutiveAdvisor",

        department:
          "Digital Infrastructure",

        expectedOutput:
          "Current website availability, performance, conversion, link, form, accessibility, and content-drift findings.",

        verification:
          "Verify the website remains reachable and the identified warning is resolved or converted into an approved remediation task.",

        safeToAutoExecute:
          true
      };

    case "domains":
      return {
        provider:
          "MILES",

        action:
          "ENGINEERING_ANALYZE",

        capability:
          "infrastructure.domains.credential_gap",

        assignedTo:
          "EngineeringOwner",

        department:
          "Infrastructure",

        expectedOutput:
          "A precise domain-access readiness report identifying which Namecheap or IONOS authentication path is missing.",

        verification:
          "Verify CredentialAuthority reports VALID or PARTIAL with a documented next action for registrar access.",

        safeToAutoExecute:
          true,

        blocked:
          true,

        blockReason:
          "Registrar authentication is unavailable."
      };

    case "miles_runtime":
      return {
        provider:
          "MILES",

        action:
          "ENGINEERING_ANALYZE",

        capability:
          "engineering.runtime.diagnose",

        assignedTo:
          "EngineeringOwner",

        department:
          "Engineering",

        expectedOutput:
          "Runtime root-cause analysis with evidence, proposed repair, validation plan, and rollback plan.",

        verification:
          "Verify runtime health returns HEALTHY after the proposed repair.",

        safeToAutoExecute:
          true
      };

    case "filesystem_c":
    case "filesystem_d":
      return {
        provider:
          "MILES",

        action:
          "ENGINEERING_ANALYZE",

        capability:
          "filesystem.health.diagnose",

        assignedTo:
          "FileSystemOwner",

        department:
          "Infrastructure",

        expectedOutput:
          "Filesystem health diagnosis including access, disk capacity, protected paths, and safe corrective actions.",

        verification:
          "Verify the filesystem remains readable and authorized write locations remain writable.",

        safeToAutoExecute:
          true
      };

    default:
      return {
        provider:
          finding.provider ||
          "MILES",

        action:
          "ENGINEERING_ANALYZE",

        capability:
          "infrastructure.finding.analyze",

        assignedTo:
          "EngineeringOwner",

        department:
          "Infrastructure",

        expectedOutput:
          "Root-cause analysis and a safe corrective plan.",

        verification:
          "Verify the original infrastructure finding is resolved.",

        safeToAutoExecute:
          true
      };
  }
}

function listQueueTasks() {
  try {
    if (
      typeof taskQueue.list ===
      "function"
    ) {
      const tasks =
        taskQueue.list();

      return Array.isArray(tasks)
        ? tasks
        : [];
    }
  } catch {}

  return [];
}

function queueInsert(task) {
  const methods = [
    "enqueue",
    "add",
    "create",
    "push",
    "submit"
  ];

  for (
    const method of methods
  ) {
    if (
      typeof taskQueue[method] ===
      "function"
    ) {
      const result =
        taskQueue[method](task);

      return {
        ok: true,
        method,
        result:
          result || task
      };
    }
  }

  throw new Error(
    "TaskQueue exposes none of the supported insertion methods: enqueue, add, create, push, submit."
  );
}

function activeDuplicate(task) {
  const fingerprint =
    task.payload
      ?.autonomousWorkFingerprint;

  if (!fingerprint) {
    return null;
  }

  return (
    listQueueTasks()
      .find(existing =>
        existing.payload
          ?.autonomousWorkFingerprint ===
          fingerprint &&
        ACTIVE_TASK_STATUSES.has(
          statusUpper(
            existing.status
          )
        )
      ) || null
  );
}

function healthStateFromManager() {
  if (
    healthManager.lastState
  ) {
    return healthManager
      .lastState;
  }

  return safeReadJson(
    path.join(
      ROOT,
      "DATA",
      "infrastructure",
      "infrastructure_health_state.json"
    ),
    null
  );
}

function credentialFindings() {
  const summary =
    credentialAuthority
      .summary();

  return (
    summary.credentials || []
  )
    .filter(item =>
      item.status !== "VALID"
    )
    .map(item => ({
      infrastructureId:
        item.infrastructureId,

      source:
        "CredentialAuthority",

      category:
        "CREDENTIAL",

      status:
        item.status,

      score:
        item.status === "PARTIAL"
          ? 60
          : 30,

      message:
        item.status === "PARTIAL"
          ? `Credential configuration is partial for ${item.infrastructureId}.`
          : `Credential configuration is missing for ${item.infrastructureId}.`,

      evidence: {
        credentialId:
          item.id,

        present:
          item.present || [],

        missing:
          item.missing || []
      }
    }));
}

function healthFindings(state) {
  if (!state) {
    return [];
  }

  const findings = [];

  for (
    const failure of
    state.failures || []
  ) {
    findings.push({
      infrastructureId:
        failure.infrastructureId,

      source:
        "InfrastructureHealthManager",

      category:
        "HEALTH",

      status:
        failure.status,

      score:
        failure.score,

      message:
        failure.message,

      evidence:
        failure
    });
  }

  for (
    const provider of
    state.providers || []
  ) {
    if (
      provider.status ===
      "HEALTHY"
    ) {
      continue;
    }

    findings.push({
      infrastructureId:
        provider.infrastructureId,

      source:
        "InfrastructureHealthManager",

      category:
        "PROVIDER",

      status:
        provider.status,

      score:
        provider.score,

      message:
        provider.message ||
        `${provider.provider} reported ${provider.providerStatus}.`,

      evidence: {
        provider:
          provider.provider,

        providerStatus:
          provider.providerStatus,

        exceptions:
          provider.exceptions || [],

        recommendations:
          provider.recommendations || [],

        durationMs:
          provider.durationMs
      }
    });
  }

  for (
    const filesystem of
    state.filesystems || []
  ) {
    if (
      filesystem.status ===
      "HEALTHY"
    ) {
      continue;
    }

    findings.push({
      infrastructureId:
        filesystem.infrastructureId,

      source:
        "InfrastructureHealthManager",

      category:
        "FILESYSTEM",

      status:
        filesystem.status,

      score:
        filesystem.score,

      message:
        filesystem.errors
          ?.join(" | ") ||
        `${filesystem.infrastructureId} requires review.`,

      evidence:
        filesystem
    });
  }

  return findings;
}

function dedupeFindings(findings) {
  const output = [];
  const seen = new Set();

  for (
    const finding of findings
  ) {
    const key =
      stableHash({
        infrastructureId:
          finding.infrastructureId,

        category:
          finding.category,

        status:
          finding.status,

        message:
          finding.message
      });

    if (
      seen.has(key)
    ) {
      continue;
    }

    seen.add(key);

    output.push({
      ...finding,
      findingKey: key
    });
  }

  return output;
}

class AutonomousWorkGenerationService {
  constructor(options = {}) {
    this.intervalMs =
      positiveNumber(
        options.intervalMs,
        DEFAULT_INTERVAL_MS
      );

    this.maxTasksPerCycle =
      positiveNumber(
        options.maxTasksPerCycle,
        DEFAULT_MAX_TASKS_PER_CYCLE
      );

    this.timer = null;
    this.started = false;
    this.running = false;
    this.lastState = null;

    this.metrics = {
      cyclesStarted: 0,
      cyclesCompleted: 0,
      cyclesSkipped: 0,
      findingsEvaluated: 0,
      tasksCreated: 0,
      duplicatesSuppressed: 0,
      tasksBlocked: 0,
      errors: 0,
      lastCycleAt: null,
      lastCycleDurationMs: null
    };
  }

  buildTask(finding) {
    const profile =
      actionProfile(
        finding.infrastructureId,
        finding
      );

    const priority =
      priorityFor(
        finding.status,
        finding.score,
        finding.category
      );

    const fingerprint =
      stableHash({
        infrastructureId:
          finding.infrastructureId,

        category:
          finding.category,

        action:
          profile.action,

        capability:
          profile.capability,

        findingKey:
          finding.findingKey
      });

    const taskId =
      [
        "AUTO",
        normalizeId(
          finding.infrastructureId
        ),
        normalizeId(
          finding.category
        ),
        fingerprint
      ].join("_");

    const objective =
      `Resolve ${finding.infrastructureId} finding: ${normalizeText(finding.message)}`;

    const plan = {
      ok: true,

      intent:
        "AUTONOMOUS_INFRASTRUCTURE_REPAIR",

      workflow:
        "INFRASTRUCTURE_HEALTH_TO_REPAIR",

      provider:
        profile.provider,

      system:
        finding.infrastructureId,

      connector:
        profile.provider,

      department:
        profile.department,

      action:
        profile.action,

      objective,

      originalCommand:
        objective,

      steps: [{
        step: 1,

        capability:
          profile.capability,

        provider:
          profile.provider,

        department:
          profile.department,

        action:
          profile.action,

        taskType:
          "WORKFORCE_STEP",

        assignedTo:
          profile.assignedTo,

        status:
          "QUEUED",

        dependsOn: [],

        expectedOutput:
          profile.expectedOutput,

        verification:
          profile.verification
      }]
    };

    return {
      id:
        taskId,

      type:
        "WORKFORCE_STEP",

      status:
        profile.blocked
          ? "AWAITING_APPROVAL"
          : "QUEUED",

      priority,

      priorityLabel:
        priorityLabel(priority),

      title:
        objective,

      action:
        profile.action,

      provider:
        profile.provider,

      connector:
        profile.provider,

      department:
        profile.department,

      createdAt:
        nowIso(),

      updatedAt:
        nowIso(),

      source:
        "AutonomousWorkGenerationService",

      payload: {
        type:
          "WORKFORCE_STEP",

        provider:
          profile.provider,

        system:
          finding.infrastructureId,

        connector:
          profile.provider,

        department:
          profile.department,

        action:
          profile.action,

        capability:
          profile.capability,

        objective,

        expectedOutput:
          profile.expectedOutput,

        verification:
          profile.verification,

        assignedTo:
          profile.assignedTo,

        priority,

        priorityLabel:
          priorityLabel(priority),

        workPackageId:
          `AUTO_WP_${fingerprint}`,

        autonomous:
          true,

        safeToAutoExecute:
          profile.safeToAutoExecute,

        blocked:
          Boolean(profile.blocked),

        blockReason:
          profile.blockReason ||
          null,

        infrastructureId:
          finding.infrastructureId,

        finding,

        autonomousWorkFingerprint:
          fingerprint,

        plan
      },

      plan
    };
  }

  collectFindings() {
    const healthState =
      healthStateFromManager();

    return dedupeFindings([
      ...healthFindings(
        healthState
      ),

      ...credentialFindings()
    ]);
  }

  submitTask(task) {
    const duplicate =
      activeDuplicate(task);

    if (duplicate) {
      this.metrics
        .duplicatesSuppressed += 1;

      return {
        ok: true,

        created: false,

        duplicate: true,

        existingTaskId:
          duplicate.id,

        task
      };
    }

    if (
      task.payload.blocked ===
      true
    ) {
      this.metrics
        .tasksBlocked += 1;
    }

    const insertion =
      queueInsert(task);

    this.metrics
      .tasksCreated += 1;

    return {
      ok: true,

      created: true,

      duplicate: false,

      insertionMethod:
        insertion.method,

      task:
        insertion.result ||
        task
    };
  }

  runCycle(options = {}) {
    if (this.running) {
      this.metrics
        .cyclesSkipped += 1;

      return {
        ok: false,
        status:
          "CYCLE_ALREADY_RUNNING",
        generatedAt:
          nowIso()
      };
    }

    this.running = true;
    this.metrics
      .cyclesStarted += 1;

    const startedAt =
      Date.now();

    try {
      const findings =
        this.collectFindings();

      this.metrics
        .findingsEvaluated +=
        findings.length;

      const selected =
        findings
          .sort((a, b) =>
            priorityFor(
              a.status,
              a.score,
              a.category
            ) -
            priorityFor(
              b.status,
              b.score,
              b.category
            )
          )
          .slice(
            0,
            positiveNumber(
              options.maxTasks,
              this.maxTasksPerCycle
            )
          );

      const generated =
        selected.map(
          finding =>
            this.buildTask(
              finding
            )
        );

      const submissions =
        generated.map(task => {
          try {
            return this.submitTask(
              task
            );
          } catch (error) {
            this.metrics
              .errors += 1;

            return {
              ok: false,
              created: false,
              task,
              error:
                error.stack ||
                error.message
            };
          }
        });

      const state = {
        ok:
          submissions.every(
            item =>
              item.ok !== false
          ),

        type:
          "AUTONOMOUS_WORK_GENERATION_STATE",

        generatedAt:
          nowIso(),

        durationMs:
          Date.now() -
          startedAt,

        findings,

        selectedFindings:
          selected,

        generatedTasks:
          generated,

        submissions,

        summary: {
          findings:
            findings.length,

          selected:
            selected.length,

          created:
            submissions.filter(
              item =>
                item.created === true
            ).length,

          duplicates:
            submissions.filter(
              item =>
                item.duplicate === true
            ).length,

          blocked:
            generated.filter(
              task =>
                task.payload.blocked ===
                true
            ).length,

          failed:
            submissions.filter(
              item =>
                item.ok === false
            ).length
        }
      };

      this.lastState =
        state;

      this.metrics
        .cyclesCompleted += 1;

      this.metrics
        .lastCycleAt =
        state.generatedAt;

      this.metrics
        .lastCycleDurationMs =
        state.durationMs;

      safeWriteJson(
        STATE_FILE,
        state
      );

      appendHistory({
        event:
          "AUTONOMOUS_WORK_GENERATION_COMPLETED",

        generatedAt:
          state.generatedAt,

        durationMs:
          state.durationMs,

        summary:
          state.summary
      });

      return state;
    } catch (error) {
      this.metrics
        .errors += 1;

      const state = {
        ok: false,

        type:
          "AUTONOMOUS_WORK_GENERATION_STATE",

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
        STATE_FILE,
        state
      );

      appendHistory({
        event:
          "AUTONOMOUS_WORK_GENERATION_FAILED",

        generatedAt:
          state.generatedAt,

        error:
          error.message
      });

      return state;
    } finally {
      this.running = false;
    }
  }

  start(options = {}) {
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

    if (
      options.runImmediately !==
      false
    ) {
      this.runCycle();
    }

    this.timer =
      setInterval(
        () => {
          try {
            this.runCycle();
          } catch (error) {
            console.error(
              "[AutonomousWorkGenerationService]",
              error
            );
          }
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
      startedAt:
        nowIso()
    };
  }

  stop() {
    if (this.timer) {
      clearInterval(
        this.timer
      );

      this.timer = null;
    }

    this.started = false;

    return {
      ok: true,
      status:
        "STOPPED",
      stoppedAt:
        nowIso()
    };
  }

  status() {
    return {
      ok: true,

      service:
        "AutonomousWorkGenerationService",

      started:
        this.started,

      running:
        this.running,

      intervalMs:
        this.intervalMs,

      maxTasksPerCycle:
        this.maxTasksPerCycle,

      stateFile:
        STATE_FILE,

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

              summary:
                this.lastState
                  .summary
            }
          : null
    };
  }

  healthCheck() {
    return {
      ok:
        this.lastState !== null ||
        this.started,

      service:
        "AutonomousWorkGenerationService",

      status:
        this.running
          ? "RUNNING"
          : this.started
            ? "IDLE"
            : this.lastState
              ? "READY"
              : "NOT_STARTED",

      metrics: {
        ...this.metrics
      },

      checkedAt:
        nowIso()
    };
  }

  execute(task = {}) {
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
      case "run":
      case "generate":
      case "refresh":
      case "cycle":
        return this.runCycle(
          payload.options || {}
        );

      case "start":
        return this.start(
          payload.options || {}
        );

      case "stop":
      case "shutdown":
        return this.stop();

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
  new AutonomousWorkGenerationService();

module.exports.AutonomousWorkGenerationService =
  AutonomousWorkGenerationService;