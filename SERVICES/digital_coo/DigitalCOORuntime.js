'use strict';

class DigitalCOORuntime {
  constructor(options = {}) {
    this.service = 'DIGITAL_COO_RUNTIME';
    this.version = '1.1.0';

    this.rootDir =
      options.rootDir ||
      process.env.MILES_ROOT ||
      process.cwd();

    this.workerRuntimeManager =
      options.workerRuntimeManager ||
      null;

    this.connectorRuntimeManager =
      options.connectorRuntimeManager ||
      null;

    this.learningEngineManager =
      options.learningEngineManager ||
      null;

    this.operationExecutionKernel =
      options.operationExecutionKernel ||
      null;

    this.executiveIntelligence =
      options.executiveIntelligence ||
      null;

    this.capabilityBuilder =
      options.capabilityBuilder ||
      null;

    this.state = {
      ok: true,
      service: this.service,
      version: this.version,
      status: 'INITIALIZED',
      generatedAt: new Date().toISOString(),

      decisionsEvaluated: 0,

      operationsAccepted: 0,
      operationsRejected: 0,
      operationsExecuted: 0,
      operationsFailed: 0,

      workerExecutions: 0,
      connectorExecutions: 0,
      kernelExecutions: 0,

      learningEventsRecorded: 0,

      lastDecisionAt: null,
      lastExecutionAt: null,
      lastExecutiveSummaryAt: null,

      lastDecision: null,
      lastExecution: null,
      lastExecutiveSummary: null,

      lastRoute: null,
      lastOperationId: null,
      lastError: null
    };
  }

  // ============================================================
  // OPERATION EVALUATION
  // ============================================================

  async evaluateOperation(operation = {}) {
    try {
      const decision =
        this.makeDecision(operation);

      this.state.decisionsEvaluated += 1;
      this.state.lastDecisionAt =
        new Date().toISOString();

      this.state.lastDecision =
        decision;

      this.state.lastOperationId =
        operation.operationId ||
        operation.id ||
        null;

      if (decision.approved) {
        this.state.operationsAccepted += 1;
      } else {
        this.state.operationsRejected += 1;
      }

      this.state.status =
        decision.approved
          ? 'OPERATION_APPROVED'
          : 'OPERATION_REJECTED';

      this.state.ok = true;
      this.state.lastError = null;

      return {
        ok: true,
        service: this.service,
        status: this.state.status,
        decision,
        state: this.getState()
      };
    } catch (error) {
      this.state.ok = false;
      this.state.status =
        'DECISION_FAILED';

      this.state.lastError =
        error.message;

      return {
        ok: false,
        service: this.service,
        status: 'DECISION_FAILED',
        error: error.message,
        state: this.getState()
      };
    }
  }

  makeDecision(operation = {}) {
    const operationType =
      operation.operationType ||
      operation.type ||
      operation.category ||
      'UNKNOWN_OPERATION';

    const requiresApproval =
      Boolean(
        operation.requiresApproval ||
        operation.requiresKevinApproval ||
        operation.approvalRequired ||
        operation.ceoEscalationOnly
      );

    const blocked =
      Boolean(
        operation.blocked ||
        operation.hold ||
        operation.doNotExecute
      );

    const hasWorker =
      Boolean(
        operation.workerId ||
        operation.worker ||
        operation.workerName ||
        operation.assignedWorker
      );

    const hasConnector =
      Boolean(
        operation.connectorId ||
        operation.connector
      );

    const hasKernel =
      Boolean(
        this.operationExecutionKernel
      );

    const executable =
      !blocked &&
      !requiresApproval &&
      (
        hasWorker ||
        hasConnector ||
        hasKernel
      );

    const reasons = [];

    if (blocked) {
      reasons.push(
        'Operation is blocked.'
      );
    }

    if (requiresApproval) {
      reasons.push(
        'Operation requires approval.'
      );
    }

    if (
      !hasWorker &&
      !hasConnector &&
      !hasKernel
    ) {
      reasons.push(
        'No worker, connector, or operation kernel is available.'
      );
    }

    if (reasons.length === 0) {
      reasons.push(
        'Operation is eligible for autonomous execution.'
      );
    }

    return {
      approved: executable,
      operationType,
      reasons,
      route:
        this.resolveRoute(operation),
      decidedAt:
        new Date().toISOString()
    };
  }

  resolveRoute(operation = {}) {
    if (
      operation.workerId ||
      operation.worker ||
      operation.workerName ||
      operation.assignedWorker
    ) {
      return 'WORKER_RUNTIME';
    }

    if (
      operation.connectorId ||
      operation.connector
    ) {
      return 'CONNECTOR_RUNTIME';
    }

    if (
      this.operationExecutionKernel
    ) {
      return 'OPERATION_EXECUTION_KERNEL';
    }

    return 'NO_ROUTE_AVAILABLE';
  }

  // ============================================================
  // OPERATION EXECUTION
  // ============================================================

  async executeOperation(operation = {}) {
    const operationId =
      operation.operationId ||
      operation.id ||
      `OP_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2, 8)}`;

    const normalizedOperation = {
      ...operation,
      operationId,
      id:
        operation.id ||
        operationId
    };

    const evaluation =
      await this.evaluateOperation(
        normalizedOperation
      );

    if (!evaluation.ok) {
      return evaluation;
    }

    if (
      !evaluation.decision.approved
    ) {
      await this.recordLearningEvent({
        eventType:
          'OPERATION_OUTCOME',

        target:
          operationId,

        ok: false,

        status:
          'OPERATION_REJECTED',

        error:
          evaluation.decision.reasons.join(
            ' '
          ),

        raw:
          normalizedOperation
      });

      return {
        ok: false,
        service: this.service,
        status:
          'OPERATION_REJECTED',
        operationId,
        decision:
          evaluation.decision,
        state:
          this.getState()
      };
    }

    try {
      const route =
        evaluation.decision.route;

      this.state.lastRoute =
        route;

      this.state.lastOperationId =
        operationId;

      let execution;

      if (
        route === 'WORKER_RUNTIME'
      ) {
        execution =
          await this.executeViaWorkerRuntime(
            normalizedOperation
          );

        this.state.workerExecutions += 1;
      } else if (
        route === 'CONNECTOR_RUNTIME'
      ) {
        execution =
          await this.executeViaConnectorRuntime(
            normalizedOperation
          );

        this.state.connectorExecutions += 1;
      } else if (
        route ===
        'OPERATION_EXECUTION_KERNEL'
      ) {
        execution =
          await this.executeViaOperationKernel(
            normalizedOperation
          );

        this.state.kernelExecutions += 1;
      } else {
        throw new Error(
          `No valid execution route for operation: ${route}`
        );
      }

      this.state.lastExecutionAt =
        new Date().toISOString();

      this.state.lastExecution = {
        operationId,
        route,
        execution
      };

      const successful =
        Boolean(
          execution &&
          execution.ok
        );

      if (successful) {
        this.state.operationsExecuted += 1;
        this.state.status =
          'OPERATION_EXECUTED';

        this.state.ok = true;
        this.state.lastError = null;
      } else {
        this.state.operationsFailed += 1;
        this.state.status =
          'OPERATION_FAILED';

        this.state.ok = false;

        this.state.lastError =
          this.extractExecutionError(
            execution
          );
      }

      await this.recordLearningEvent({
        eventType:
          'OPERATION_OUTCOME',

        target:
          operationId,

        ok:
          successful,

        status:
          execution &&
          execution.status
            ? execution.status
            : this.state.status,

        error:
          successful
            ? null
            : this.extractExecutionError(
                execution
              ),

        raw: {
          operation:
            normalizedOperation,
          decision:
            evaluation.decision,
          execution
        }
      });

      return {
        ok: successful,
        service: this.service,
        status:
          this.state.status,
        operationId,
        route,
        decision:
          evaluation.decision,
        execution,
        state:
          this.getState()
      };
    } catch (error) {
      this.state.operationsFailed += 1;

      this.state.status =
        'OPERATION_FAILED';

      this.state.ok = false;

      this.state.lastError =
        error.message;

      this.state.lastExecutionAt =
        new Date().toISOString();

      this.state.lastExecution = {
        operationId,
        route:
          evaluation.decision.route,
        error:
          error.message
      };

      await this.recordLearningEvent({
        eventType:
          'OPERATION_OUTCOME',

        target:
          operationId,

        ok: false,

        status:
          'OPERATION_FAILED',

        error:
          error.message,

        raw:
          normalizedOperation
      });

      return {
        ok: false,
        service: this.service,
        status:
          'OPERATION_FAILED',
        operationId,
        route:
          evaluation.decision.route,
        error:
          error.message,
        state:
          this.getState()
      };
    }
  }

  // ============================================================
  // WORKER EXECUTION
  // ============================================================

  async executeViaWorkerRuntime(
    operation = {}
  ) {
    const manager =
      this.workerRuntimeManager;

    if (!manager) {
      throw new Error(
        'Worker Runtime Manager is unavailable.'
      );
    }

    /*
     * Preferred route:
     * Execute the exact operation through the manager.
     */

    if (
      typeof manager.executeWorker ===
      'function'
    ) {
      return await manager.executeWorker(
        operation
      );
    }

    if (
      typeof manager.dispatch ===
      'function'
    ) {
      return await manager.dispatch(
        operation
      );
    }

    if (
      typeof manager.execute ===
      'function'
    ) {
      return await manager.execute(
        operation
      );
    }

    if (
      typeof manager.processOperation ===
      'function'
    ) {
      return await manager.processOperation(
        operation
      );
    }

    /*
     * Fallback route:
     * Execute through the manager's underlying runtime.
     */

    const runtime =
      manager.runtime ||
      manager.workerRuntime ||
      null;

    if (runtime) {
      if (
        typeof runtime.executeWorker ===
        'function'
      ) {
        return await runtime.executeWorker(
          operation
        );
      }

      if (
        typeof runtime.dispatch ===
        'function'
      ) {
        return await runtime.dispatch(
          operation
        );
      }

      if (
        typeof runtime.execute ===
        'function'
      ) {
        return await runtime.execute(
          operation
        );
      }

      if (
        typeof runtime.processOperation ===
        'function'
      ) {
        return await runtime.processOperation(
          operation
        );
      }

      if (
        runtime.dispatcher &&
        typeof runtime.dispatcher.dispatch ===
          'function'
      ) {
        return await runtime.dispatcher.dispatch(
          operation
        );
      }
    }

    /*
     * Final fallback:
     * Use the dispatcher attached directly to the manager.
     */

    if (
      manager.dispatcher &&
      typeof manager.dispatcher.dispatch ===
        'function'
    ) {
      return await manager.dispatcher.dispatch(
        operation
      );
    }

    /*
     * Do not call runCycle() here.
     *
     * runCycle() is a polling/scheduling action and does not
     * guarantee that this specific user-issued operation is
     * executed.
     */

    throw new Error(
      'Worker Runtime Manager cannot execute the supplied operation. Expected executeWorker(), dispatch(), execute(), processOperation(), or an executable runtime/dispatcher.'
    );
  }

  // ============================================================
  // CONNECTOR EXECUTION
  // ============================================================

  async executeViaConnectorRuntime(
    operation = {}
  ) {
    const manager =
      this.connectorRuntimeManager;

    if (!manager) {
      throw new Error(
        'Connector Runtime Manager is unavailable.'
      );
    }

    if (
      typeof manager.execute ===
      'function'
    ) {
      return await manager.execute(
        operation
      );
    }

    if (
      typeof manager.dispatch ===
      'function'
    ) {
      return await manager.dispatch(
        operation
      );
    }

    if (
      typeof manager.executeOperation ===
      'function'
    ) {
      return await manager.executeOperation(
        operation
      );
    }

    if (
      typeof manager.processOperation ===
      'function'
    ) {
      return await manager.processOperation(
        operation
      );
    }

    const runtime =
      manager.runtime ||
      manager.connectorRuntime ||
      null;

    if (runtime) {
      if (
        typeof runtime.execute ===
        'function'
      ) {
        return await runtime.execute(
          operation
        );
      }

      if (
        typeof runtime.dispatch ===
        'function'
      ) {
        return await runtime.dispatch(
          operation
        );
      }

      if (
        typeof runtime.executeOperation ===
        'function'
      ) {
        return await runtime.executeOperation(
          operation
        );
      }
    }

    throw new Error(
      'Connector Runtime Manager cannot execute the supplied operation.'
    );
  }

  // ============================================================
  // OPERATION KERNEL EXECUTION
  // ============================================================

  async executeViaOperationKernel(
    operation = {}
  ) {
    const kernel =
      this.operationExecutionKernel;

    if (!kernel) {
      throw new Error(
        'Operation Execution Kernel is unavailable.'
      );
    }

    if (
      typeof kernel.execute ===
      'function'
    ) {
      return await kernel.execute(
        operation
      );
    }

    if (
      typeof kernel.run ===
      'function'
    ) {
      return await kernel.run(
        operation
      );
    }

    if (
      typeof kernel.process ===
      'function'
    ) {
      return await kernel.process(
        operation
      );
    }

    if (
      typeof kernel.executeOperation ===
      'function'
    ) {
      return await kernel.executeOperation(
        operation
      );
    }

    throw new Error(
      'Operation Execution Kernel does not expose execute(), run(), process(), or executeOperation().'
    );
  }

  // ============================================================
  // LEARNING
  // ============================================================

  async recordLearningEvent(
    event = {}
  ) {
    if (
      !this.learningEngineManager
    ) {
      return {
        ok: false,
        service: this.service,
        status:
          'LEARNING_ENGINE_MANAGER_UNAVAILABLE'
      };
    }

    try {
      let result;

      if (
        typeof this.learningEngineManager
          .recordEvent === 'function'
      ) {
        result =
          await this.learningEngineManager
            .recordEvent(event);
      } else if (
        typeof this.learningEngineManager
          .recordOperationOutcome ===
        'function'
      ) {
        result =
          await this.learningEngineManager
            .recordOperationOutcome(event);
      } else {
        return {
          ok: false,
          service: this.service,
          status:
            'LEARNING_RECORD_METHOD_UNAVAILABLE'
        };
      }

      if (
        result &&
        result.ok
      ) {
        this.state.learningEventsRecorded += 1;
      }

      return result;
    } catch (error) {
      return {
        ok: false,
        service: this.service,
        status:
          'LEARNING_EVENT_FAILED',
        error:
          error.message
      };
    }
  }

  // ============================================================
  // EXECUTIVE SUMMARY
  // ============================================================

  async getExecutiveSummary() {
    const summary = {
      ok: true,
      service: this.service,
      status:
        'DIGITAL_COO_SUMMARY_READY',
      generatedAt:
        new Date().toISOString(),

      digitalCOOState:
        this.getState(),

      workerRuntime:
        await this.safeManagerHealth(
          this.workerRuntimeManager
        ),

      connectorRuntime:
        await this.safeManagerHealth(
          this.connectorRuntimeManager
        ),

      learningEngine:
        this.learningEngineManager &&
        typeof this.learningEngineManager
          .getExecutiveSummary ===
          'function'
          ? await this.learningEngineManager
              .getExecutiveSummary()
          : await this.safeManagerHealth(
              this.learningEngineManager
            ),

      executiveIntelligence:
        await this.safeExecutiveIntelligence()
    };

    this.state.lastExecutiveSummaryAt =
      new Date().toISOString();

    this.state.lastExecutiveSummary =
      summary;

    return summary;
  }

  // ============================================================
  // HEALTH
  // ============================================================

  async safeManagerHealth(manager) {
    if (!manager) {
      return {
        ok: false,
        status:
          'MANAGER_UNAVAILABLE'
      };
    }

    try {
      if (
        typeof manager.healthCheck ===
        'function'
      ) {
        return await manager.healthCheck();
      }

      if (
        typeof manager.getState ===
        'function'
      ) {
        return {
          ok: true,
          status:
            'STATE_AVAILABLE',
          state:
            manager.getState()
        };
      }

      return {
        ok: false,
        status:
          'HEALTH_AND_STATE_UNAVAILABLE'
      };
    } catch (error) {
      return {
        ok: false,
        status:
          'MANAGER_HEALTH_FAILED',
        error:
          error.message
      };
    }
  }

  async safeExecutiveIntelligence() {
    if (
      !this.executiveIntelligence
    ) {
      return {
        ok: false,
        status:
          'EXECUTIVE_INTELLIGENCE_UNAVAILABLE'
      };
    }

    try {
      if (
        typeof this.executiveIntelligence
          .getExecutiveSummary ===
          'function'
      ) {
        return await this.executiveIntelligence
          .getExecutiveSummary();
      }

      if (
        typeof this.executiveIntelligence
          .getState === 'function'
      ) {
        return {
          ok: true,
          status:
            'EXECUTIVE_STATE_AVAILABLE',
          state:
            this.executiveIntelligence
              .getState()
        };
      }

      return {
        ok: false,
        status:
          'EXECUTIVE_INTELLIGENCE_METHOD_UNAVAILABLE'
      };
    } catch (error) {
      return {
        ok: false,
        status:
          'EXECUTIVE_INTELLIGENCE_FAILED',
        error:
          error.message
      };
    }
  }

  async healthCheck() {
    const workerHealth =
      await this.safeManagerHealth(
        this.workerRuntimeManager
      );

    const connectorHealth =
      await this.safeManagerHealth(
        this.connectorRuntimeManager
      );

    const learningHealth =
      await this.safeManagerHealth(
        this.learningEngineManager
      );

    const ok =
      workerHealth.ok !== false &&
      connectorHealth.ok !== false &&
      learningHealth.ok !== false;

    this.state.ok =
      ok;

    if (
      this.state.status ===
        'INITIALIZED' ||
      this.state.status ===
        'HEALTHY' ||
      this.state.status ===
        'DEGRADED'
    ) {
      this.state.status =
        ok
          ? 'HEALTHY'
          : 'DEGRADED';
    }

    if (ok) {
      this.state.lastError = null;
    }

    return {
      ok,
      service: this.service,
      version: this.version,
      status:
        ok
          ? 'HEALTHY'
          : 'DEGRADED',

      workerRuntime:
        workerHealth,

      connectorRuntime:
        connectorHealth,

      learningEngine:
        learningHealth,

      state:
        this.getState(),

      generatedAt:
        new Date().toISOString()
    };
  }

  // ============================================================
  // HELPERS
  // ============================================================

  extractExecutionError(
    execution
  ) {
    if (!execution) {
      return 'Execution returned no result.';
    }

    return (
      execution.error ||
      execution.reason ||
      execution.message ||
      (
        execution.result &&
        (
          execution.result.error ||
          execution.result.reason ||
          execution.result.message
        )
      ) ||
      'Execution failed without a detailed error.'
    );
  }

  getState() {
    return {
      ...this.state,
      generatedAt:
        new Date().toISOString()
    };
  }
}

module.exports =
  DigitalCOORuntime;

module.exports.DigitalCOORuntime =
  DigitalCOORuntime;

module.exports.default =
  DigitalCOORuntime;