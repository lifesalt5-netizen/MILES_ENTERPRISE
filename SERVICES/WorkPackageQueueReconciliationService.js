"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT =
  process.env.MILES_ROOT ||
  process.cwd();

const WORK_PACKAGE_DIR =
  path.join(
    ROOT,
    "DATA",
    "work_packages"
  );

const REPORT_DIR =
  path.join(
    ROOT,
    "DATA",
    "runtime",
    "reconciliation"
  );

const taskQueue =
  require("../CORE/TaskQueue");

const taskManager =
  require("./TaskManager");

const ACTIVE_PACKAGE_STATUSES =
  new Set([
    "QUEUED",
    "READY",
    "RUNNING",
    "IN_PROGRESS",
    "IN PROGRESS",
    "BLOCKED"
  ]);

const ACTIVE_TASK_STATUSES =
  new Set([
    "QUEUED",
    "PENDING",
    "AUTHORIZED",
    "RUNNING",
    "AWAITING_APPROVAL",
    "AWAITING_CEO_APPROVAL",
    "BLOCKED"
  ]);

function nowIso() {
  return new Date().toISOString();
}

function normalizeStatus(value) {
  return String(value || "")
    .trim()
    .replace(/-/g, "_")
    .toUpperCase();
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function parseTime(value) {
  const parsed =
    Date.parse(value || "");

  return Number.isFinite(parsed)
    ? parsed
    : 0;
}

function packageTime(workPackage) {
  return Math.max(
    parseTime(workPackage.updatedAt),
    parseTime(workPackage.createdAt)
  );
}

function safeReadJson(file) {
  try {
    return JSON.parse(
      fs.readFileSync(
        file,
        "utf8"
      )
    );
  } catch (error) {
    return {
      __readError: true,
      __file: file,
      __error:
        error.stack ||
        error.message
    };
  }
}

function atomicWriteJson(file, value) {
  fs.mkdirSync(
    path.dirname(file),
    {
      recursive: true
    }
  );

  const temporary =
    `${file}.tmp_` +
    `${process.pid}_` +
    `${Date.now()}`;

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
    fs.copyFileSync(
      temporary,
      file
    );
  } finally {
    try {
      fs.unlinkSync(
        temporary
      );
    } catch {}
  }
}

function stepNumber(step, index) {
  const direct =
    Number(step?.step);

  if (
    Number.isFinite(direct)
  ) {
    return direct;
  }

  return index + 1;
}

function stepIdentity(
  workPackageId,
  step,
  index
) {
  const payload = {
    workPackageId:
      String(workPackageId || ""),

    step:
      stepNumber(
        step,
        index
      ),

    taskType:
      normalizeText(
        step?.taskType ||
        "WORKFORCE_STEP"
      ),

    capability:
      normalizeText(
        step?.capability
      ),

    provider:
      normalizeText(
        step?.provider
      ),

    action:
      normalizeText(
        step?.action
      )
  };

  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify(payload)
    )
    .digest("hex");
}

function workPackageKey(workPackage) {
  const signature =
    normalizeText(
      workPackage.signature
    );

  if (signature) {
    return `SIGNATURE:${signature}`;
  }

  const objective =
    normalizeText(
      workPackage.objective
    );

  const taskShape =
    Array.isArray(
      workPackage.tasks
    )
      ? workPackage.tasks
          .map((step, index) => [
            stepNumber(step, index),
            normalizeText(step.capability),
            normalizeText(step.provider),
            normalizeText(step.action),
            normalizeText(step.taskType)
          ].join("|"))
          .join("||")
      : "";

  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        objective,
        taskShape
      })
    )
    .digest("hex");
}

function listWorkPackages() {
  if (
    !fs.existsSync(
      WORK_PACKAGE_DIR
    )
  ) {
    return {
      packages: [],
      readErrors: []
    };
  }

  const packages = [];
  const readErrors = [];

  for (
    const filename of
    fs.readdirSync(
      WORK_PACKAGE_DIR
    )
  ) {
    if (
      !filename
        .toLowerCase()
        .endsWith(".json")
    ) {
      continue;
    }

    const file =
      path.join(
        WORK_PACKAGE_DIR,
        filename
      );

    const value =
      safeReadJson(file);

    if (
      value &&
      value.__readError
    ) {
      readErrors.push(value);
      continue;
    }

    if (
      !value ||
      typeof value !== "object" ||
      !value.id
    ) {
      readErrors.push({
        __readError: true,
        __file: file,
        __error:
          "Work package is not a valid object with an ID."
      });

      continue;
    }

    packages.push({
      ...value,
      __file: file
    });
  }

  return {
    packages,
    readErrors
  };
}

function taskPackageId(task) {
  return String(
    task?.payload
      ?.workPackageId ||
    task?.workPackageId ||
    ""
  ).trim();
}

function activeTaskIdentity(task) {
  const existingIdentity =
    String(
      task?.payload
        ?.reconciliation
        ?.stepIdentity ||
      task?.reconciliation
        ?.stepIdentity ||
      ""
    ).trim();

  if (existingIdentity) {
    return existingIdentity;
  }

  const step = {
    step:
      task?.payload
        ?.step ||
      task?.step,

    taskType:
      task?.type,

    capability:
      task?.payload
        ?.capability ||
      task?.capability,

    provider:
      task?.payload
        ?.provider ||
      task?.provider,

    action:
      task?.payload
        ?.action ||
      task?.action
  };

  return stepIdentity(
    taskPackageId(task),
    step,
    Number(step.step || 1) - 1
  );
}

function activeTaskIdentities(tasks) {
  const identities =
    new Set();

  for (
    const task of
    tasks
  ) {
    if (
      !ACTIVE_TASK_STATUSES.has(
        normalizeStatus(
          task.status
        )
      )
    ) {
      continue;
    }

    identities.add(
      activeTaskIdentity(task)
    );
  }

  return identities;
}

function selectCanonicalPackages(packages) {
  const byKey =
    new Map();

  for (
    const workPackage of
    packages
  ) {
    const status =
      normalizeStatus(
        workPackage.status
      );

    if (
      !ACTIVE_PACKAGE_STATUSES.has(
        status
      )
    ) {
      continue;
    }

    if (
      !Array.isArray(
        workPackage.tasks
      ) ||
      workPackage.tasks.length === 0
    ) {
      continue;
    }

    const key =
      workPackageKey(
        workPackage
      );

    const existing =
      byKey.get(key);

    if (
      !existing ||
      packageTime(workPackage) >
        packageTime(existing)
    ) {
      byKey.set(
        key,
        workPackage
      );
    }
  }

  return Array.from(
    byKey.values()
  ).sort(
    (a, b) =>
      packageTime(b) -
      packageTime(a)
  );
}

function missingStepsForPackage(
  workPackage,
  activeIdentities
) {
  return workPackage.tasks
    .map((step, index) => {
      const identity =
        stepIdentity(
          workPackage.id,
          step,
          index
        );

      return {
        index,
        stepNumber:
          stepNumber(
            step,
            index
          ),
        identity,
        step
      };
    })
    .filter(item =>
      !activeIdentities.has(
        item.identity
      )
    );
}

function buildTaskPayload(
  workPackage,
  stepItem,
  reconciliationId
) {
  const step =
    stepItem.step;

  return {
    workPackageId:
      workPackage.id,

    step:
      stepItem.stepNumber,

    objective:
      workPackage.objective,

    capability:
      step.capability,

    assignedTo:
      step.assignedTo,

    department:
      step.department,

    provider:
      step.provider || null,

    action:
      step.action,

    expectedOutput:
      step.expectedOutput,

    verification:
      step.verification,

    reconciliation: {
      source:
        "BUILD136",

      reconciliationId,

      stepIdentity:
        stepItem.identity,

      recoveredAt:
        nowIso(),

      reason:
        "Canonical active work-package step had no corresponding active queue task."
    }
  };
}

function priorityFor(workPackage) {
  const direct =
    Number(
      workPackage.priorityScore
    );

  if (
    Number.isFinite(direct)
  ) {
    return direct;
  }

  const text =
    normalizeStatus(
      workPackage.priority
    );

  if (text === "CRITICAL") {
    return 100;
  }

  if (text === "HIGH") {
    return 85;
  }

  if (text === "MEDIUM") {
    return 60;
  }

  if (text === "LOW") {
    return 35;
  }

  return 50;
}

class WorkPackageQueueReconciliationService {
  inspect(options = {}) {
    const {
      packages,
      readErrors
    } = listWorkPackages();

    const queueTasks =
      taskQueue.list();

    const activeIdentities =
      activeTaskIdentities(
        queueTasks
      );

    const canonicalPackages =
      selectCanonicalPackages(
        packages
      );

    const recoverable =
      canonicalPackages
        .map(workPackage => {
          const missingSteps =
            missingStepsForPackage(
              workPackage,
              activeIdentities
            );

          return {
            id:
              workPackage.id,

            signature:
              workPackage.signature ||
              null,

            objective:
              workPackage.objective,

            status:
              workPackage.status,

            priority:
              workPackage.priority,

            priorityScore:
              workPackage.priorityScore,

            createdAt:
              workPackage.createdAt,

            updatedAt:
              workPackage.updatedAt,

            totalStepCount:
              workPackage.tasks.length,

            missingStepCount:
              missingSteps.length,

            missingSteps:
              missingSteps.map(item => ({
                step:
                  item.stepNumber,

                identity:
                  item.identity,

                taskType:
                  item.step.taskType ||
                  "WORKFORCE_STEP",

                capability:
                  item.step.capability ||
                  null,

                provider:
                  item.step.provider ||
                  null,

                action:
                  item.step.action ||
                  null
              })),

            file:
              workPackage.__file
          };
        })
        .filter(item =>
          item.missingStepCount > 0
        );

    return {
      ok:
        readErrors.length === 0,

      inspectedAt:
        nowIso(),

      queueTaskCount:
        queueTasks.length,

      totalWorkPackages:
        packages.length,

      activePackageCount:
        packages.filter(item =>
          ACTIVE_PACKAGE_STATUSES.has(
            normalizeStatus(
              item.status
            )
          )
        ).length,

      canonicalActivePackages:
        canonicalPackages.length,

      recoverablePackageCount:
        recoverable.length,

      recoverableStepCount:
        recoverable.reduce(
          (sum, item) =>
            sum +
            item.missingStepCount,
          0
        ),

      recoverable,

      readErrors,

      options
    };
  }

  reconcile(options = {}) {
    const apply =
      options.apply === true;

    const maxPackages =
      Number.isFinite(
        Number(
          options.maxPackages
        )
      )
        ? Math.max(
            0,
            Math.floor(
              Number(
                options.maxPackages
              )
            )
          )
        : 46;

    const inspection =
      this.inspect(options);

    if (
      inspection.readErrors.length >
      0
    ) {
      return {
        ...inspection,
        applied: false,
        createdTaskCount: 0,
        error:
          "Reconciliation stopped because one or more work-package files could not be read."
      };
    }

    const selected =
      inspection.recoverable.slice(
        0,
        maxPackages
      );

    const reconciliationId =
      `RECON-${Date.now()}-` +
      crypto
        .randomBytes(3)
        .toString("hex")
        .toUpperCase();

    const result = {
      ...inspection,

      reconciliationId,

      applied:
        apply,

      maxPackages,

      selectedPackageCount:
        selected.length,

      selectedStepCount:
        selected.reduce(
          (sum, item) =>
            sum +
            item.missingStepCount,
          0
        ),

      selectedPackages:
        selected,

      createdTasks: [],

      createdTaskCount: 0,

      skippedSteps: [],

      failedSteps: [],

      startedAt:
        nowIso()
    };

    if (!apply) {
      result.completedAt =
        nowIso();

      result.message =
        "Dry run only. No queue tasks were created.";

      result.reportFile =
        this.writeReport(result);

      return result;
    }

    const allPackages =
      listWorkPackages()
        .packages;

    const packageById =
      new Map(
        allPackages.map(
          workPackage => [
            workPackage.id,
            workPackage
          ]
        )
      );

    for (
      const selectedPackage of
      selected
    ) {
      const workPackage =
        packageById.get(
          selectedPackage.id
        );

      if (!workPackage) {
        result.failedSteps.push({
          workPackageId:
            selectedPackage.id,

          reason:
            "Work package disappeared before reconciliation."
        });

        continue;
      }

      for (
        let index = 0;
        index < workPackage.tasks.length;
        index++
      ) {
        const step =
          workPackage.tasks[index];

        const identity =
          stepIdentity(
            workPackage.id,
            step,
            index
          );

        const currentQueue =
          taskQueue.list();

        const currentIdentities =
          activeTaskIdentities(
            currentQueue
          );

        if (
          currentIdentities.has(
            identity
          )
        ) {
          result.skippedSteps.push({
            workPackageId:
              workPackage.id,

            step:
              stepNumber(
                step,
                index
              ),

            identity,

            reason:
              "An active task already exists for this exact work-package step."
          });

          continue;
        }

        if (
          !step ||
          !step.action
        ) {
          result.failedSteps.push({
            workPackageId:
              workPackage.id,

            step:
              stepNumber(
                step,
                index
              ),

            identity,

            reason:
              "Step is missing an action."
          });

          continue;
        }

        const stepItem = {
          index,

          stepNumber:
            stepNumber(
              step,
              index
            ),

          identity,

          step
        };

        try {
          const task =
            taskManager.create(
              step.taskType ||
                "WORKFORCE_STEP",

              buildTaskPayload(
                workPackage,
                stepItem,
                reconciliationId
              ),

              priorityFor(
                workPackage
              )
            );

          result.createdTasks.push({
            id:
              task.id,

            status:
              task.status,

            type:
              task.type,

            priority:
              task.priority,

            workPackageId:
              workPackage.id,

            step:
              stepItem.stepNumber,

            stepIdentity:
              identity,

            provider:
              step.provider ||
              null,

            action:
              step.action
          });
        } catch (error) {
          result.failedSteps.push({
            workPackageId:
              workPackage.id,

            step:
              stepItem.stepNumber,

            identity,

            error:
              error.stack ||
              error.message
          });

          result.createdTaskCount =
            result.createdTasks.length;

          result.queueTaskCountAfter =
            taskQueue.list().length;

          result.completedAt =
            nowIso();

          result.message =
            "Reconciliation stopped after a task creation failure. It may be safely rerun.";

          result.reportFile =
            this.writeReport(result);

          throw error;
        }
      }
    }

    result.createdTaskCount =
      result.createdTasks.length;

    result.queueTaskCountAfter =
      taskQueue.list().length;

    result.remainingRecovery =
      this.inspect({
        source:
          "post-apply"
      });

    result.completedAt =
      nowIso();

    result.message =
      result.remainingRecovery
        .recoverableStepCount === 0
        ? "Queue recovery completed. No canonical work-package steps remain orphaned."
        : "Queue recovery completed with remaining recoverable steps.";

    result.reportFile =
      this.writeReport(result);

    return result;
  }

  writeReport(result) {
    fs.mkdirSync(
      REPORT_DIR,
      {
        recursive: true
      }
    );

    const filename =
      `work_package_reconciliation_` +
      `${Date.now()}.json`;

    const file =
      path.join(
        REPORT_DIR,
        filename
      );

    atomicWriteJson(
      file,
      result
    );

    return file;
  }
}

module.exports =
  new WorkPackageQueueReconciliationService();
