"use strict";

const commandQueue = require("../CORE/CommandQueue");
const bootstrapWorkers = require("./WorkerBootstrap");

const REQUIRED_WORKERS = Object.freeze([
  "SELF_DEVELOPMENT",
  "ARCHITECT",
  "BUILDER",
  "VALIDATOR",
  "TESTER",
  "DEPLOYER",
  "RECOVERY",
  "ATLAS"
]);

function normalizeType(type) {
  return String(type || "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
}

class WorkerExecutionBridge {
  constructor() {
    this.registry = require("./WorkerRegistry");
    this.ensureWorkersRegistered();
  }

  ensureWorkersRegistered() {
    const missingBefore = REQUIRED_WORKERS.filter(
      type => !this.registry.get(type)
    );

    if (missingBefore.length) {
      bootstrapWorkers();
    }

    const missingAfter = REQUIRED_WORKERS.filter(
      type => !this.registry.get(type)
    );

    return {
      ok: missingAfter.length === 0,
      registered: this.registry.list(),
      recovered: missingBefore.filter(
        type => !missingAfter.includes(type)
      ),
      missing: missingAfter
    };
  }

  register(name, worker) {
    return this.registry.register(
      normalizeType(name),
      worker
    );
  }

  executeNext() {
    const task = commandQueue.claim("WorkerExecutionBridge");

    if (!task) {
      return {
        status: "NO_TASK",
        workers: this.registry.list()
      };
    }

    const registration = this.ensureWorkersRegistered();
    const taskType = normalizeType(task.type);
    const worker = this.registry.get(taskType);

    if (!worker || typeof worker.execute !== "function") {
      const error = new Error(
        `No executable worker registered for ${taskType || task.type}`
      );

      commandQueue.fail(task.id, error);

      return {
        status: "FAILED",
        reason: error.message,
        taskType,
        registration
      };
    }

    try {
      const result = worker.execute({
        ...task,
        type: taskType
      });

      commandQueue.complete(task.id, result);

      return {
        status: "COMPLETED",
        task: {
          ...task,
          type: taskType
        },
        result,
        registration
      };
    } catch (error) {
      commandQueue.fail(task.id, error);

      return {
        status: "FAILED",
        taskType,
        error: error.message,
        registration
      };
    }
  }
}

module.exports = WorkerExecutionBridge;
