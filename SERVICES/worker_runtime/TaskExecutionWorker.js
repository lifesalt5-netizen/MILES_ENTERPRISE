'use strict';

const BaseAutonomousWorker = require('./BaseAutonomousWorker');

class TaskExecutionWorker extends BaseAutonomousWorker {
  constructor(options = {}) {
    super({
      ...options,
      workerId: options.workerId || 'TASK_EXECUTION_WORKER',
      workerName: options.workerName || 'Task Execution Worker',
      workerType: options.workerType || 'TASK_EXECUTION',
      description:
        options.description ||
        'Generic autonomous task execution worker for Digital COO operations.'
    });

    this.service = 'TASK_EXECUTION_WORKER';
    this.version = '1.0.1';

    this.supportedActions = options.supportedActions || [
      'NOOP',
      'CONNECTOR_CALL',
      'DECISION_REQUEST',
      'EXECUTIVE_EVENT',
      'LEARNING_EVENT'
    ];
  }

  async execute(input = {}, context = {}) {
    return await this.run(input, {
      ...context,
      source:
        context.source ||
        'TaskExecutionWorker.execute'
    });
  }

  async run(input = {}, context = {}) {
    const task = this.normalizeTask(input);

    const validation = this.validateTask(task);

    if (!validation.ok) {
      return {
        ok: false,
        service: this.service,
        workerId: this.workerId,
        status: 'TASK_VALIDATION_FAILED',
        validation,
        task
      };
    }

    await this.updateTaskStatus(
      task,
      'IN_PROGRESS',
      {
        executionId: context.executionId
      }
    );

    let result;

    if (task.requiresDecision) {
      const decision =
        await this.requestDecision({
          operationId: task.taskId,
          operationType: task.action,
          priority: task.priority,
          confidence: task.confidence,
          requiresApproval:
            task.requiresApproval,
          payload: task.payload
        });

      if (!decision || !decision.ok) {
        await this.updateTaskStatus(
          task,
          'DECISION_REJECTED',
          {
            decision
          }
        );

        return {
          ok: false,
          service: this.service,
          workerId: this.workerId,
          status:
            'TASK_DECISION_REJECTED',
          task,
          decision
        };
      }
    }

    switch (task.action) {
      case 'NOOP':
        result =
          await this.executeNoop(task);
        break;

      case 'CONNECTOR_CALL':
        result =
          await this.executeConnectorCall(
            task
          );
        break;

      case 'DECISION_REQUEST':
        result =
          await this.executeDecisionRequest(
            task
          );
        break;

      case 'EXECUTIVE_EVENT':
        result =
          await this.executeExecutiveEvent(
            task
          );
        break;

      case 'LEARNING_EVENT':
        result =
          await this.executeLearningEvent(
            task
          );
        break;

      default:
        result =
          await this.executeCustomTask(
            task,
            context
          );
        break;
    }

    await this.updateTaskStatus(
      task,
      result && result.ok
        ? 'COMPLETED'
        : 'FAILED',
      {
        result
      }
    );

    return {
      ok: Boolean(result && result.ok),
      service: this.service,
      workerId: this.workerId,
      status:
        result && result.ok
          ? 'TASK_COMPLETED'
          : 'TASK_FAILED',
      task,
      result
    };
  }

  normalizeTask(input = {}) {
    const safeInput =
      input &&
      typeof input === 'object' &&
      !Array.isArray(input)
        ? input
        : {};

    const nestedTask =
      safeInput.task &&
      typeof safeInput.task === 'object' &&
      !Array.isArray(safeInput.task)
        ? safeInput.task
        : {};

    const directPayload =
      safeInput.payload &&
      typeof safeInput.payload === 'object' &&
      !Array.isArray(safeInput.payload)
        ? safeInput.payload
        : {};

    /*
     * The top-level operation action is authoritative.
     *
     * DigitalCOOHost and WorkerDispatcher pass the complete
     * operation object to the worker. A nested payload may
     * contain old metadata such as:
     *
     *   payload.action = INSTANTLY_CAMPAIGNS
     *
     * That legacy nested value must never override:
     *
     *   input.action = SYNC_CAMPAIGNS
     */
    const resolvedAction =
      safeInput.action ||
      safeInput.operation ||
      safeInput.operationType ||
      nestedTask.action ||
      nestedTask.operation ||
      nestedTask.operationType ||
      directPayload.action ||
      directPayload.operation ||
      directPayload.operationType ||
      'NOOP';

    /*
     * Preserve the operation's actual business payload.
     *
     * For a standard operation:
     *
     *   {
     *     action: 'SYNC_CAMPAIGNS',
     *     payload: { ... }
     *   }
     *
     * task.payload must remain the full input.payload object.
     */
    let resolvedPayload = {};

    if (
      nestedTask.payload &&
      typeof nestedTask.payload === 'object' &&
      !Array.isArray(nestedTask.payload)
    ) {
      resolvedPayload =
        nestedTask.payload;
    } else if (
      nestedTask.input &&
      typeof nestedTask.input === 'object' &&
      !Array.isArray(nestedTask.input)
    ) {
      resolvedPayload =
        nestedTask.input;
    } else if (
      nestedTask.data &&
      typeof nestedTask.data === 'object' &&
      !Array.isArray(nestedTask.data)
    ) {
      resolvedPayload =
        nestedTask.data;
    } else if (
      safeInput.payload &&
      typeof safeInput.payload === 'object' &&
      !Array.isArray(safeInput.payload)
    ) {
      resolvedPayload =
        safeInput.payload;
    } else if (
      safeInput.input &&
      typeof safeInput.input === 'object' &&
      !Array.isArray(safeInput.input)
    ) {
      resolvedPayload =
        safeInput.input;
    } else if (
      safeInput.data &&
      typeof safeInput.data === 'object' &&
      !Array.isArray(safeInput.data)
    ) {
      resolvedPayload =
        safeInput.data;
    }

    const resolvedPriority =
      nestedTask.priority ??
      safeInput.priority ??
      directPayload.priority ??
      3;

    const resolvedConfidence =
      typeof nestedTask.confidence ===
      'number'
        ? nestedTask.confidence
        : typeof safeInput.confidence ===
            'number'
          ? safeInput.confidence
          : typeof directPayload.confidence ===
              'number'
            ? directPayload.confidence
            : 0.9;

    const resolvedRequiresApproval =
      nestedTask.requiresApproval ??
      nestedTask.approvalRequired ??
      safeInput.requiresApproval ??
      safeInput.approvalRequired ??
      directPayload.requiresApproval ??
      directPayload.approvalRequired ??
      false;

    const resolvedRequiresDecision =
      nestedTask.requiresDecision ??
      safeInput.requiresDecision ??
      directPayload.requiresDecision ??
      false;

    return {
      taskId:
        safeInput.taskId ||
        safeInput.id ||
        safeInput.operationId ||
        nestedTask.taskId ||
        nestedTask.id ||
        directPayload.taskId ||
        directPayload.id ||
        `TASK_${Date.now()}_${Math.random()
          .toString(36)
          .slice(2, 8)}`,

      action:
        String(resolvedAction)
          .trim()
          .toUpperCase(),

      priority:
        Number(resolvedPriority),

      confidence:
        resolvedConfidence,

      requiresApproval:
        Boolean(
          resolvedRequiresApproval
        ),

      requiresDecision:
        Boolean(
          resolvedRequiresDecision
        ),

      connectorId:
        safeInput.connectorId ||
        safeInput.connector ||
        nestedTask.connectorId ||
        nestedTask.connector ||
        directPayload.connectorId ||
        directPayload.connector ||
        null,

      connectorAction:
        safeInput.connectorAction ||
        safeInput.method ||
        safeInput.connectorMethod ||
        nestedTask.connectorAction ||
        nestedTask.method ||
        nestedTask.connectorMethod ||
        directPayload.connectorAction ||
        directPayload.method ||
        directPayload.connectorMethod ||
        null,

      payload:
        resolvedPayload,

      metadata:
        safeInput.metadata ||
        nestedTask.metadata ||
        directPayload.metadata ||
        {},

      raw:
        safeInput,

      createdAt:
        safeInput.createdAt ||
        nestedTask.createdAt ||
        directPayload.createdAt ||
        new Date().toISOString()
    };
  }

  validateTask(task = {}) {
    const errors = [];

    if (!task.taskId) {
      errors.push('Missing taskId.');
    }

    if (!task.action) {
      errors.push(
        'Missing task action.'
      );
    }

    if (
      !this.supportedActions.includes(
        task.action
      ) &&
      typeof this.executeCustomTask !==
        'function'
    ) {
      errors.push(
        `Unsupported task action: ${task.action}`
      );
    }

    if (
      task.action ===
      'CONNECTOR_CALL'
    ) {
      if (!task.connectorId) {
        errors.push(
          'CONNECTOR_CALL requires connectorId.'
        );
      }

      if (!task.connectorAction) {
        errors.push(
          'CONNECTOR_CALL requires connectorAction.'
        );
      }
    }

    return {
      ok: errors.length === 0,
      service: this.service,
      status:
        errors.length === 0
          ? 'TASK_VALID'
          : 'TASK_INVALID',
      errors
    };
  }

  async updateTaskStatus(
    task = {},
    status,
    details = {}
  ) {
    const event = {
      eventType:
        'OPERATION_OUTCOME',
      target: task.taskId,
      ok:
        !String(status).includes(
          'FAILED'
        ) &&
        !String(status).includes(
          'REJECTED'
        ),
      status: `TASK_${status}`,
      raw: {
        task,
        details
      }
    };

    await this.emitLearningEvent(
      event
    );

    await this.recordExecutiveEvent(
      {
        eventType: 'TASK_STATUS',
        taskId: task.taskId,
        taskAction: task.action,
        status,
        details
      }
    );

    return {
      ok: true,
      service: this.service,
      workerId: this.workerId,
      status: `TASK_${status}`,
      taskId: task.taskId
    };
  }

  async executeNoop(task = {}) {
    return {
      ok: true,
      service: this.service,
      workerId: this.workerId,
      status: 'NOOP_COMPLETED',
      taskId: task.taskId,
      payload: task.payload
    };
  }

  async executeConnectorCall(
    task = {}
  ) {
    return await this.callConnector(
      task.connectorId,
      task.connectorAction,
      task.payload,
      {
        taskId: task.taskId,
        action: task.action,
        metadata: task.metadata
      }
    );
  }

  async executeDecisionRequest(
    task = {}
  ) {
    return await this.requestDecision(
      {
        operationId: task.taskId,
        operationType:
          task.payload.operationType ||
          'TASK_DECISION_REQUEST',
        priority: task.priority,
        confidence: task.confidence,
        requiresApproval:
          task.requiresApproval,
        payload: task.payload
      }
    );
  }

  async executeExecutiveEvent(
    task = {}
  ) {
    return await this.recordExecutiveEvent(
      {
        eventType:
          task.payload.eventType ||
          'TASK_EXECUTIVE_EVENT',
        taskId: task.taskId,
        payload: task.payload,
        metadata: task.metadata
      }
    );
  }

  async executeLearningEvent(
    task = {}
  ) {
    return await this.emitLearningEvent(
      {
        eventType:
          task.payload.eventType ||
          'TASK_LEARNING_EVENT',
        target:
          task.payload.target ||
          task.taskId,
        ok:
          task.payload.ok !== false,
        status:
          task.payload.status ||
          'TASK_LEARNING_EVENT_RECORDED',
        error:
          task.payload.error ||
          null,
        raw: task.payload
      }
    );
  }

  async executeCustomTask(
    task = {}
  ) {
    return {
      ok: false,
      service: this.service,
      workerId: this.workerId,
      status:
        'CUSTOM_TASK_NOT_IMPLEMENTED',
      taskId: task.taskId,
      action: task.action
    };
  }

  getMetadata() {
    return {
      ...super.getMetadata(),
      service: this.service,
      supportedActions:
        this.supportedActions
    };
  }
}

module.exports =
  TaskExecutionWorker;