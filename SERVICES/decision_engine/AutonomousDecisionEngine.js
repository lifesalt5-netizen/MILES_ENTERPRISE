'use strict';

const fs = require('fs');
const path = require('path');

class AutonomousDecisionEngine {
  constructor(options = {}) {
    this.service = 'AUTONOMOUS_DECISION_ENGINE';
    this.version = '1.0.0';

    this.rootDir = options.rootDir || process.cwd();

    this.executiveIntelligence = options.executiveIntelligence || null;
    this.missionEngine = options.missionEngine || null;
    this.capabilityBuilder = options.capabilityBuilder || null;
    this.operationExecutionKernel = options.operationExecutionKernel || null;
    this.learningEngineManager = options.learningEngineManager || null;
    this.digitalCOORuntimeManager = options.digitalCOORuntimeManager || null;

    this.runtimeDir =
      options.runtimeDir ||
      path.join(this.rootDir, 'runtime');

    this.decisionDir =
      options.decisionDir ||
      path.join(this.runtimeDir, 'decision_engine');

    this.statePath =
      options.statePath ||
      path.join(this.decisionDir, 'decision_engine_state.json');

    this.decisionLogPath =
      options.decisionLogPath ||
      path.join(this.decisionDir, 'decision_log.jsonl');

    this.rejectedDecisionLogPath =
      options.rejectedDecisionLogPath ||
      path.join(this.decisionDir, 'rejected_decisions.jsonl');

    this.approvedDecisionLogPath =
      options.approvedDecisionLogPath ||
      path.join(this.decisionDir, 'approved_decisions.jsonl');

    this.policy = {
      allowAutonomousExecution: options.allowAutonomousExecution !== false,
      requireApprovalForExternalSend: true,
      requireApprovalForPricing: true,
      requireApprovalForHiring: true,
      requireApprovalForDeletion: true,
      requireApprovalForContracts: true,
      maxPriorityToAutoExecute: Number(options.maxPriorityToAutoExecute || 3),
      minimumConfidenceToExecute: Number(options.minimumConfidenceToExecute || 0.7)
    };

    this.state = {
      ok: true,
      service: this.service,
      version: this.version,
      status: 'INITIALIZED',
      generatedAt: new Date().toISOString(),
      decisionsEvaluated: 0,
      decisionsApproved: 0,
      decisionsRejected: 0,
      decisionsRouted: 0,
      decisionsFailed: 0,
      lastDecisionAt: null,
      lastApprovedAt: null,
      lastRejectedAt: null,
      lastRoutedAt: null,
      lastDecision: null,
      lastRouteResult: null,
      lastError: null
    };

    this.ensureStorage();
    this.loadState();
  }

  ensureStorage() {
    if (!fs.existsSync(this.decisionDir)) {
      fs.mkdirSync(this.decisionDir, { recursive: true });
    }

    if (!fs.existsSync(this.decisionLogPath)) {
      fs.writeFileSync(this.decisionLogPath, '', 'utf8');
    }

    if (!fs.existsSync(this.approvedDecisionLogPath)) {
      fs.writeFileSync(this.approvedDecisionLogPath, '', 'utf8');
    }

    if (!fs.existsSync(this.rejectedDecisionLogPath)) {
      fs.writeFileSync(this.rejectedDecisionLogPath, '', 'utf8');
    }

    if (!fs.existsSync(this.statePath)) {
      this.persistState();
    }
  }

  loadState() {
    try {
      if (!fs.existsSync(this.statePath)) {
        return;
      }

      const raw = fs.readFileSync(this.statePath, 'utf8');

      if (!raw.trim()) {
        return;
      }

      const loaded = JSON.parse(raw);

      this.state = {
        ...this.state,
        ...loaded,
        service: this.service,
        version: this.version
      };
    } catch (error) {
      this.state.ok = false;
      this.state.status = 'STATE_LOAD_FAILED';
      this.state.lastError = error.message;
      this.persistState();
    }
  }

  persistState() {
    this.state.generatedAt = new Date().toISOString();
    fs.writeFileSync(this.statePath, JSON.stringify(this.getState(), null, 2), 'utf8');
  }

  appendJsonLine(filePath, payload) {
    fs.appendFileSync(
      filePath,
      `${JSON.stringify({
        ...payload,
        loggedAt: new Date().toISOString()
      })}\n`,
      'utf8'
    );
  }

  async evaluate(input = {}) {
    try {
      const normalized = this.normalizeDecisionInput(input);
      const context = await this.gatherContext(normalized);
      const decision = this.makeDecision(normalized, context);

      this.state.decisionsEvaluated += 1;
      this.state.lastDecisionAt = new Date().toISOString();
      this.state.lastDecision = decision;

      if (decision.approved) {
        this.state.decisionsApproved += 1;
        this.state.lastApprovedAt = new Date().toISOString();
        this.appendJsonLine(this.approvedDecisionLogPath, decision);
      } else {
        this.state.decisionsRejected += 1;
        this.state.lastRejectedAt = new Date().toISOString();
        this.appendJsonLine(this.rejectedDecisionLogPath, decision);
      }

      this.state.status = decision.approved ? 'DECISION_APPROVED' : 'DECISION_REJECTED';
      this.state.lastError = null;

      this.appendJsonLine(this.decisionLogPath, decision);
      this.persistState();

      await this.recordLearningEvent({
        eventType: 'OPERATION_OUTCOME',
        target: decision.operationId,
        ok: decision.approved,
        status: this.state.status,
        error: decision.approved ? null : decision.reasons.join(' '),
        raw: decision
      });

      return {
        ok: true,
        service: this.service,
        status: this.state.status,
        decision,
        state: this.getState()
      };
    } catch (error) {
      this.state.decisionsFailed += 1;
      this.state.ok = false;
      this.state.status = 'DECISION_EVALUATION_FAILED';
      this.state.lastError = error.message;
      this.persistState();

      return {
        ok: false,
        service: this.service,
        status: 'DECISION_EVALUATION_FAILED',
        error: error.message,
        state: this.getState()
      };
    }
  }

  normalizeDecisionInput(input = {}) {
    const operation = input.operation || input;

    return {
      decisionId:
        input.decisionId ||
        operation.decisionId ||
        `DECISION_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,

      operationId:
        operation.operationId ||
        operation.id ||
        `OP_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,

      operationType:
        operation.operationType ||
        operation.type ||
        operation.category ||
        'UNKNOWN_OPERATION',

      priority: Number(operation.priority || input.priority || 3),

      confidence:
        typeof operation.confidence === 'number'
          ? operation.confidence
          : typeof input.confidence === 'number'
            ? input.confidence
            : 0.75,

      requiresApproval: Boolean(
        operation.requiresApproval ||
          operation.requiresKevinApproval ||
          operation.approvalRequired ||
          input.requiresApproval
      ),

      blocked: Boolean(
        operation.blocked ||
          operation.hold ||
          operation.doNotExecute ||
          input.blocked
      ),

      operation,
      metadata: input.metadata || operation.metadata || {},
      requestedAt: input.requestedAt || operation.requestedAt || new Date().toISOString()
    };
  }

  async gatherContext(normalized) {
    const context = {
      gatheredAt: new Date().toISOString(),
      executive: await this.safeExecutiveSummary(),
      mission: await this.safeMissionStatus(),
      learning: await this.safeLearningSummary(),
      capability: await this.safeCapabilityStatus(),
      runtime: await this.safeDigitalCOOState()
    };

    return {
      ...context,
      risk: this.calculateRisk(normalized, context)
    };
  }

  makeDecision(normalized, context) {
    const reasons = [];
    const risks = context.risk || [];

    if (!this.policy.allowAutonomousExecution) {
      reasons.push('Autonomous execution is disabled by policy.');
    }

    if (normalized.blocked) {
      reasons.push('Operation is explicitly blocked.');
    }

    if (normalized.requiresApproval) {
      reasons.push('Operation requires approval.');
    }

    if (normalized.priority > this.policy.maxPriorityToAutoExecute) {
      reasons.push(`Priority ${normalized.priority} exceeds autonomous threshold ${this.policy.maxPriorityToAutoExecute}.`);
    }

    if (normalized.confidence < this.policy.minimumConfidenceToExecute) {
      reasons.push(`Confidence ${normalized.confidence} is below minimum ${this.policy.minimumConfidenceToExecute}.`);
    }

    for (const risk of risks) {
      if (risk.blocking) {
        reasons.push(risk.reason);
      }
    }

    if (this.requiresProtectedApproval(normalized.operationType, normalized.operation)) {
      reasons.push('Operation touches a protected approval category.');
    }

    const approved = reasons.length === 0;

    if (approved) {
      reasons.push('Operation cleared autonomous decision policy.');
    }

    return {
      decisionId: normalized.decisionId,
      operationId: normalized.operationId,
      operationType: normalized.operationType,
      approved,
      route: this.resolveRoute(normalized.operation),
      priority: normalized.priority,
      confidence: normalized.confidence,
      reasons,
      risks,
      policy: this.policy,
      operation: normalized.operation,
      context,
      decidedAt: new Date().toISOString()
    };
  }

  requiresProtectedApproval(operationType, operation = {}) {
    const text = `${operationType} ${JSON.stringify(operation)}`.toLowerCase();

    if (this.policy.requireApprovalForExternalSend) {
      if (
        text.includes('send_email') ||
        text.includes('send proposal') ||
        text.includes('send client') ||
        text.includes('external_send')
      ) {
        return true;
      }
    }

    if (this.policy.requireApprovalForPricing) {
      if (
        text.includes('pricing') ||
        text.includes('price') ||
        text.includes('discount') ||
        text.includes('quote')
      ) {
        return true;
      }
    }

    if (this.policy.requireApprovalForHiring) {
      if (
        text.includes('hire') ||
        text.includes('contractor') ||
        text.includes('vendor engagement')
      ) {
        return true;
      }
    }

    if (this.policy.requireApprovalForDeletion) {
      if (
        text.includes('delete') ||
        text.includes('remove data') ||
        text.includes('drop table') ||
        text.includes('destroy')
      ) {
        return true;
      }
    }

    if (this.policy.requireApprovalForContracts) {
      if (
        text.includes('sign') ||
        text.includes('agreement') ||
        text.includes('contract execution')
      ) {
        return true;
      }
    }

    return false;
  }

  calculateRisk(normalized, context) {
    const risks = [];

    const learningMetrics =
      context &&
      context.learning &&
      context.learning.metrics
        ? context.learning.metrics
        : null;

    if (learningMetrics && learningMetrics.repeatedFailures) {
      const target =
        normalized.operation.workerId ||
        normalized.operation.connectorId ||
        normalized.operation.operationType ||
        normalized.operationType;

      if (learningMetrics.repeatedFailures[target]) {
        risks.push({
          type: 'REPEATED_FAILURE',
          blocking: true,
          reason: `Repeated failure exists for target: ${target}`
        });
      }
    }

    if (
      context &&
      context.runtime &&
      context.runtime.ok === false
    ) {
      risks.push({
        type: 'RUNTIME_DEGRADED',
        blocking: true,
        reason: 'Digital COO runtime is degraded or unavailable.'
      });
    }

    return risks;
  }

  resolveRoute(operation = {}) {
    if (operation.workerId || operation.worker || operation.assignedWorker) {
      return 'DIGITAL_COO_WORKER_RUNTIME';
    }

    if (operation.connectorId || operation.connector) {
      return 'DIGITAL_COO_CONNECTOR_RUNTIME';
    }

    if (this.operationExecutionKernel) {
      return 'OPERATION_EXECUTION_KERNEL';
    }

    if (this.digitalCOORuntimeManager) {
      return 'DIGITAL_COO_RUNTIME_MANAGER';
    }

    return 'NO_ROUTE_AVAILABLE';
  }

  async decideAndRoute(input = {}) {
    const evaluation = await this.evaluate(input);

    if (!evaluation.ok) {
      return evaluation;
    }

    const decision = evaluation.decision;

    if (!decision.approved) {
      return {
        ok: false,
        service: this.service,
        status: 'DECISION_NOT_ROUTED',
        decision,
        state: this.getState()
      };
    }

    const routeResult = await this.routeDecision(decision);

    this.state.lastRouteResult = routeResult;
    this.state.lastRoutedAt = new Date().toISOString();

    if (routeResult && routeResult.ok) {
      this.state.decisionsRouted += 1;
      this.state.status = 'DECISION_ROUTED';
    } else {
      this.state.decisionsFailed += 1;
      this.state.status = 'DECISION_ROUTE_FAILED';
      this.state.lastError =
        routeResult && routeResult.error ? routeResult.error : 'Unknown routing failure';
    }

    this.persistState();

    return {
      ok: Boolean(routeResult && routeResult.ok),
      service: this.service,
      status: this.state.status,
      decision,
      routeResult,
      state: this.getState()
    };
  }

  async routeDecision(decision) {
    if (
      this.digitalCOORuntimeManager &&
      typeof this.digitalCOORuntimeManager.enqueueOperation === 'function'
    ) {
      return this.digitalCOORuntimeManager.enqueueOperation({
        ...decision.operation,
        operationId: decision.operationId,
        decisionId: decision.decisionId,
        decisionApprovedAt: decision.decidedAt,
        decisionRoute: decision.route
      });
    }

    if (
      this.operationExecutionKernel &&
      typeof this.operationExecutionKernel.execute === 'function'
    ) {
      return await this.operationExecutionKernel.execute(decision.operation);
    }

    if (
      this.operationExecutionKernel &&
      typeof this.operationExecutionKernel.run === 'function'
    ) {
      return await this.operationExecutionKernel.run(decision.operation);
    }

    return {
      ok: false,
      service: this.service,
      status: 'NO_ROUTE_AVAILABLE',
      error: 'No Digital COO queue or Operation Execution Kernel route is available.'
    };
  }

  async safeExecutiveSummary() {
    if (!this.executiveIntelligence) {
      return {
        ok: false,
        status: 'EXECUTIVE_INTELLIGENCE_UNAVAILABLE'
      };
    }

    if (typeof this.executiveIntelligence.getExecutiveSummary === 'function') {
      return await this.executiveIntelligence.getExecutiveSummary();
    }

    if (typeof this.executiveIntelligence.getState === 'function') {
      return {
        ok: true,
        status: 'EXECUTIVE_STATE_AVAILABLE',
        state: this.executiveIntelligence.getState()
      };
    }

    return {
      ok: false,
      status: 'EXECUTIVE_INTELLIGENCE_METHOD_UNAVAILABLE'
    };
  }

  async safeMissionStatus() {
    if (!this.missionEngine) {
      return {
        ok: false,
        status: 'MISSION_ENGINE_UNAVAILABLE'
      };
    }

    if (typeof this.missionEngine.getStatus === 'function') {
      return await this.missionEngine.getStatus();
    }

    if (typeof this.missionEngine.getState === 'function') {
      return {
        ok: true,
        status: 'MISSION_STATE_AVAILABLE',
        state: this.missionEngine.getState()
      };
    }

    return {
      ok: false,
      status: 'MISSION_ENGINE_METHOD_UNAVAILABLE'
    };
  }

  async safeLearningSummary() {
    if (!this.learningEngineManager) {
      return {
        ok: false,
        status: 'LEARNING_ENGINE_MANAGER_UNAVAILABLE'
      };
    }

    if (typeof this.learningEngineManager.getExecutiveSummary === 'function') {
      return this.learningEngineManager.getExecutiveSummary();
    }

    if (typeof this.learningEngineManager.safeGetMetrics === 'function') {
      const metrics = this.learningEngineManager.safeGetMetrics();
      return {
        ok: true,
        status: 'LEARNING_METRICS_AVAILABLE',
        metrics: metrics && metrics.metrics ? metrics.metrics : metrics
      };
    }

    return {
      ok: false,
      status: 'LEARNING_ENGINE_METHOD_UNAVAILABLE'
    };
  }

  async safeCapabilityStatus() {
    if (!this.capabilityBuilder) {
      return {
        ok: false,
        status: 'CAPABILITY_BUILDER_UNAVAILABLE'
      };
    }

    if (typeof this.capabilityBuilder.getState === 'function') {
      return {
        ok: true,
        status: 'CAPABILITY_STATE_AVAILABLE',
        state: this.capabilityBuilder.getState()
      };
    }

    if (typeof this.capabilityBuilder.healthCheck === 'function') {
      return await this.capabilityBuilder.healthCheck();
    }

    return {
      ok: false,
      status: 'CAPABILITY_BUILDER_METHOD_UNAVAILABLE'
    };
  }

  async safeDigitalCOOState() {
    if (!this.digitalCOORuntimeManager) {
      return {
        ok: false,
        status: 'DIGITAL_COO_RUNTIME_MANAGER_UNAVAILABLE'
      };
    }

    if (typeof this.digitalCOORuntimeManager.healthCheck === 'function') {
      return await this.digitalCOORuntimeManager.healthCheck();
    }

    if (typeof this.digitalCOORuntimeManager.getState === 'function') {
      return {
        ok: true,
        status: 'DIGITAL_COO_STATE_AVAILABLE',
        state: this.digitalCOORuntimeManager.getState()
      };
    }

    return {
      ok: false,
      status: 'DIGITAL_COO_RUNTIME_MANAGER_METHOD_UNAVAILABLE'
    };
  }

  async recordLearningEvent(event = {}) {
    if (!this.learningEngineManager) {
      return {
        ok: false,
        service: this.service,
        status: 'LEARNING_ENGINE_MANAGER_UNAVAILABLE'
      };
    }

    if (typeof this.learningEngineManager.recordEvent === 'function') {
      return this.learningEngineManager.recordEvent(event);
    }

    if (typeof this.learningEngineManager.recordOperationOutcome === 'function') {
      return this.learningEngineManager.recordOperationOutcome(event);
    }

    return {
      ok: false,
      service: this.service,
      status: 'LEARNING_RECORD_METHOD_UNAVAILABLE'
    };
  }

  async healthCheck() {
    const decisionDirExists = fs.existsSync(this.decisionDir);
    const statePathExists = fs.existsSync(this.statePath);
    const decisionLogExists = fs.existsSync(this.decisionLogPath);
    const approvedLogExists = fs.existsSync(this.approvedDecisionLogPath);
    const rejectedLogExists = fs.existsSync(this.rejectedDecisionLogPath);

    const ok =
      decisionDirExists &&
      statePathExists &&
      decisionLogExists &&
      approvedLogExists &&
      rejectedLogExists;

    return {
      ok,
      service: this.service,
      version: this.version,
      status: ok ? 'HEALTHY' : 'DEGRADED',
      paths: {
        decisionDir: this.decisionDir,
        statePath: this.statePath,
        decisionLogPath: this.decisionLogPath,
        approvedDecisionLogPath: this.approvedDecisionLogPath,
        rejectedDecisionLogPath: this.rejectedDecisionLogPath
      },
      storage: {
        decisionDirExists,
        statePathExists,
        decisionLogExists,
        approvedLogExists,
        rejectedLogExists
      },
      policy: this.policy,
      state: this.getState()
    };
  }

  getState() {
    return {
      ...this.state,
      generatedAt: new Date().toISOString()
    };
  }
}

module.exports = AutonomousDecisionEngine;