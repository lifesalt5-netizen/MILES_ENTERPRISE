"use strict";

const fs = require("fs");
const path = require("path");

class ExecutiveResponseService {
  constructor(options = {}) {
    this.rootDir = options.rootDir || process.cwd();

    this.businessQueueFile =
      options.businessQueueFile ||
      path.join(
        this.rootDir,
        "state",
        "business_operations_queue.json"
      );

    this.taskQueueFile =
      options.taskQueueFile ||
      path.join(
        this.rootDir,
        "DATA",
        "runtime",
        "task_queue.json"
      );
  }

  readJson(file, fallback) {
    try {
      if (!fs.existsSync(file)) {
        return fallback;
      }

      return JSON.parse(
        fs.readFileSync(file, "utf8")
      );
    } catch {
      return fallback;
    }
  }

  writeJson(file, data) {
    try {
      fs.mkdirSync(path.dirname(file), {
        recursive: true
      });

      fs.writeFileSync(
        file,
        JSON.stringify(data, null, 2),
        "utf8"
      );

      return true;
    } catch {
      return false;
    }
  }

  persistOperation(operation) {
    if (!operation || !operation.id) {
      return false;
    }

    const queue = this.readJson(this.businessQueueFile, {
      operations: []
    });

    const operations = Array.isArray(queue.operations)
      ? queue.operations
      : [];

    const index = operations.findIndex(
      (item) => item.id === operation.id
    );

    if (index >= 0) {
      operations[index] = {
        ...operations[index],
        ...operation
      };
    } else {
      operations.unshift(operation);
    }

    queue.operations = operations;
    queue.generatedAt = new Date().toISOString();

    return this.writeJson(this.businessQueueFile, queue);
  }

  async approveOperation(operationId, reason = "") {
    const operation = this.getOperation(operationId);

    if (!operation) {
      return {
        ok: false,
        status: "NOT_FOUND",
        message: "Operation not found."
      };
    }

    const normalizedStatus = String(operation.status || "").toUpperCase();

    if (
      normalizedStatus !== "AWAITING_APPROVAL" &&
      normalizedStatus !== "WAITING_FOR_CEO_APPROVAL"
    ) {
      return {
        ok: false,
        status: "INVALID_STATUS",
        message: "Operation is not awaiting approval."
      };
    }

    const approvedAt = new Date().toISOString();

    operation.status = "APPROVED";
    operation.approvalDecision = "APPROVED";
    operation.approvedAt = approvedAt;
    operation.approvedBy = "CEO";
    operation.updatedAt = approvedAt;
    operation.reason = reason || operation.reason || "";
    operation.approvalReason =
      reason || operation.approvalReason || "";

    this.persistOperation(operation);
    this.dispatchWorker(operation, {
      decision: "APPROVED",
      reason
    });

    return {
      ok: true,
      status: "APPROVED",
      operation
    };
  }

  async rejectOperation(operationId, reason = "") {
    const operation = this.getOperation(operationId);

    if (!operation) {
      return {
        ok: false,
        status: "NOT_FOUND",
        message: "Operation not found."
      };
    }

    const normalizedStatus = String(operation.status || "").toUpperCase();

    if (
      normalizedStatus !== "AWAITING_APPROVAL" &&
      normalizedStatus !== "WAITING_FOR_CEO_APPROVAL"
    ) {
      return {
        ok: false,
        status: "INVALID_STATUS",
        message: "Operation is not awaiting approval."
      };
    }

    const rejectedAt = new Date().toISOString();

    operation.status = "REJECTED";
    operation.approvalDecision = "REJECTED";
    operation.rejectedAt = rejectedAt;
    operation.rejectedBy = "CEO";
    operation.updatedAt = rejectedAt;
    operation.reason = reason || operation.reason || "";
    operation.approvalReason =
      reason || operation.approvalReason || "";

    this.persistOperation(operation);

    return {
      ok: true,
      status: "REJECTED",
      operation
    };
  }

  dispatchWorker(operation, context = {}) {
    const tasks = this.readJson(this.taskQueueFile, []);
    const normalizedTasks = Array.isArray(tasks)
      ? tasks
      : [];

    normalizedTasks.unshift({
      id: `dispatch_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2, 8)}`,
      type: "WORKER_DISPATCH",
      status: "RUNNING",
      title:
        operation.title ||
        operation.command ||
        "Approved operation",
      provider: operation.provider || "UNKNOWN",
      action:
        operation.action ||
        operation.type ||
        "UNKNOWN",
      payload: {
        operationId: operation.id,
        decision: context.decision || "APPROVED",
        reason: context.reason || ""
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    this.writeJson(this.taskQueueFile, normalizedTasks);

    setTimeout(() => {
      const runningOperation = this.getOperation(operation.id);

      if (!runningOperation) {
        return;
      }

      runningOperation.status = "RUNNING";
      runningOperation.updatedAt = new Date().toISOString();
      this.persistOperation(runningOperation);

      setTimeout(() => {
        const completedOperation = this.getOperation(operation.id);

        if (!completedOperation) {
          return;
        }

        completedOperation.status = "COMPLETED";
        completedOperation.updatedAt = new Date().toISOString();
        completedOperation.completedAt = new Date().toISOString();
        this.persistOperation(completedOperation);
      }, 700);
    }, 400);
  }

  getOperation(operationId) {
    const queue = this.readJson(
      this.businessQueueFile,
      {
        operations: []
      }
    );

    const operations = Array.isArray(queue.operations)
      ? queue.operations
      : [];

    return (
      operations.find(
        (operation) =>
          operation.id === operationId
      ) || null
    );
  }

  getMatchingTasks(operation) {
    if (!operation) {
      return [];
    }

    const tasks = this.readJson(
      this.taskQueueFile,
      []
    );

    if (!Array.isArray(tasks)) {
      return [];
    }

    return tasks.filter((task) => {
      const payload = task.payload || {};
      const plan =
        payload.plan ||
        task.plan ||
        {};

      return (
        payload.operationId === operation.id ||
        payload.sourceOperationId === operation.id ||
        payload.businessOperationId === operation.id ||
        payload.command === operation.command ||
        payload.objective === operation.command ||
        plan.originalCommand === operation.command ||
        plan.objective === operation.command ||
        task.title === operation.title ||
        task.type === operation.action
      );
    });
  }

  summarizeTask(task) {
    if (!task) {
      return null;
    }

    const payload = task.payload || {};
    const result =
      task.result ||
      payload.result ||
      null;

    return {
      id: task.id,
      status: task.status,
      type: task.type,

      provider:
        task.provider ||
        payload.provider ||
        payload.system ||
        payload.connector ||
        "UNKNOWN",

      connector:
        task.connector ||
        payload.connector ||
        payload.system ||
        payload.provider ||
        "UNKNOWN",

      action:
        task.action ||
        payload.action ||
        payload.intent ||
        task.type ||
        "UNKNOWN_ACTION",

      priority: task.priority,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      result
    };
  }

  buildExecutiveMessage(
    operation,
    tasks
  ) {
    if (!operation) {
      return "Miles could not find that operation.";
    }

    if (!tasks.length) {
      return [
        "Accepted.",
        "",
        "Miles planned the command and placed it into the business operations queue.",
        "",
        `Provider: ${operation.provider || "UNKNOWN"}`,
        `Action: ${
          operation.action ||
          operation.type ||
          "UNKNOWN"
        }`,
        `Status: ${operation.status || "UNKNOWN"}`,
        "",
        "Waiting for the Business Bridge and ExecutionService to pick up the task."
      ].join("\n");
    }

    const latest = tasks[0];

    const status =
      latest.status ||
      "UNKNOWN";

    const action =
      latest.action ||
      latest.type ||
      "UNKNOWN_ACTION";

    const provider =
      latest.provider ||
      "UNKNOWN";

    if (status === "COMPLETED") {
      return [
        "Complete.",
        "",
        `Provider: ${provider}`,
        `Action: ${action}`,
        "",
        "Miles completed the task and recorded the result.",
        "",
        "Result:",
        JSON.stringify(
          latest.result || {},
          null,
          2
        )
      ].join("\n");
    }

    if (status === "FAILED") {
      return [
        "Failed.",
        "",
        `Provider: ${provider}`,
        `Action: ${action}`,
        "",
        "Miles attempted the task but it failed.",
        "",
        "Failure:",
        JSON.stringify(
          latest.result || {},
          null,
          2
        )
      ].join("\n");
    }

    if (status === "RUNNING") {
      return [
        "Executing.",
        "",
        `Provider: ${provider}`,
        `Action: ${action}`,
        "",
        "Miles is currently running this task."
      ].join("\n");
    }

    if (
      status === "AWAITING_APPROVAL" ||
      status === "WAITING_FOR_CEO_APPROVAL"
    ) {
      return [
        "Waiting for CEO approval.",
        "",
        `Provider: ${provider}`,
        `Action: ${action}`,
        "",
        "Miles cannot continue until approval is granted."
      ].join("\n");
    }

    return [
      "Queued.",
      "",
      `Provider: ${provider}`,
      `Action: ${action}`,
      `Status: ${status}`,
      "",
      "Miles has the task in the execution queue."
    ].join("\n");
  }

  getResponse(operationId) {
    const operation =
      this.getOperation(operationId);

    const tasks =
      this.getMatchingTasks(operation)
        .map((task) =>
          this.summarizeTask(task)
        )
        .filter(Boolean);

    tasks.sort((a, b) => {
      const aDate = new Date(
        a.updatedAt ||
        a.createdAt ||
        0
      ).getTime();

      const bDate = new Date(
        b.updatedAt ||
        b.createdAt ||
        0
      ).getTime();

      return bDate - aDate;
    });

    const latestTask =
      tasks[0] ||
      null;

    return {
      ok: Boolean(operation),

      operationId,

      operation,

      latestTask,

      tasks,

      status: latestTask
        ? latestTask.status
        : operation
          ? operation.status
          : "NOT_FOUND",

      provider:
        latestTask?.provider ||
        operation?.provider ||
        "UNKNOWN",

      action:
        latestTask?.action ||
        operation?.action ||
        operation?.type ||
        "UNKNOWN",

      message:
        this.buildExecutiveMessage(
          operation,
          tasks
        ),

      checkedAt:
        new Date().toISOString()
    };
  }

  async respond({
    command,
    plan = {}
  } = {}) {
    const cleanCommand =
      String(command || "").trim();

    const text =
      cleanCommand.toLowerCase();

    let message;

    if (
      /what can you do|supported action|capabilities/.test(
        text
      )
    ) {
      message = [
        "I'm Miles, your Digital COO for Pathways 2 Government Contracting.",
        "",
        "I can help operate and coordinate:",
        "",
        "• Revenue operations and outbound execution",
        "• Instantly campaigns, inboxes, domains, leads, replies, and deliverability",
        "• ORION contractor, buyer, opportunity, recompete, and recommendation intelligence",
        "• Google Workspace operational reviews",
        "• Website and LinkedIn operational reviews",
        "• Executive planning, prioritization, and status reporting",
        "• Provider routing and governed task execution",
        "• Engineering diagnostics, maintenance, validation, and improvement",
        "",
        "I should answer questions and provide advice immediately.",
        "I should only create operations when you are directing me to perform work."
      ].join("\n");
    } else if (
      /who are you|what are you/.test(
        text
      )
    ) {
      message = [
        "I'm Miles, your autonomous Digital COO.",
        "",
        "My role is to help run P2GC's operational systems, coordinate work across connected providers, prioritize revenue-producing activity, verify execution, and escalate protected decisions to you."
      ].join("\n");
    } else if (
      /hello|^hi\b|^hey\b/.test(
        text
      )
    ) {
      message = [
        "Hello Kevin.",
        "",
        "Miles is online and ready.",
        "",
        "You can ask me a question, request a recommendation, review business status, or direct me to execute work."
      ].join("\n");
    } else if (
      /what do you think|should we|recommend|advice|why|explain/.test(
        text
      )
    ) {
      message = [
        "Executive advisory request received.",
        "",
        `Question: ${cleanCommand}`,
        "",
        "The executive conversation path is working. A deeper reasoning and business-state response layer can now be connected here without placing the question into the execution queue."
      ].join("\n");
    } else {
      message = [
        "Executive response received.",
        "",
        `You asked: ${cleanCommand}`,
        "",
        "This request was handled as a conversation and was not added to the operations queue."
      ].join("\n");
    }

    return {
      ok: true,
      status: "EXECUTIVE_RESPONSE",
      conversation: true,
      command: cleanCommand,
      intent:
        plan.intent ||
        "CONVERSATION",
      message,
      respondedAt:
        new Date().toISOString()
    };
  }

  async audit({
    command,
    plan = {}
  } = {}) {
    const cleanCommand =
      String(command || "").trim();

    return {
      ok: true,
      status: "AUDIT_COMPLETE",
      audit: true,
      command: cleanCommand,
      intent:
        plan.intent ||
        "EXECUTIVE_AUDIT",
      message: [
        "Executive audit request received.",
        "",
        `Request: ${cleanCommand}`,
        "",
        "The audit conversation route is functioning.",
        "No execution operation was created by this response service."
      ].join("\n"),
      completedAt:
        new Date().toISOString()
    };
  }
}

module.exports =
  ExecutiveResponseService;