'use strict';

const taskQueue = require('../CORE/TaskQueue');
const connectorManager = require('../CORE/ConnectorManager');
const eventBus = require('../CORE/EventBus');
const { log } = require('../CORE/logger');
const memory = require('./MemoryService');
const executionService = require('./ExecutionService');

const PATCH = Symbol.for('MILES_EXECUTION_STATUS_SEMANTICS_OVERRIDE_APPLIED');

function upper(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizeSemanticStatus(result = {}) {
  const raw = upper(result.status);

  if (raw === 'AWAITING_APPROVAL' || raw === 'AWAITING_CEO_APPROVAL' || raw === 'WAITING_FOR_CEO_APPROVAL') {
    return 'AWAITING_APPROVAL';
  }
  if (raw === 'BLOCKED') return 'BLOCKED';
  if (raw === 'IN_PROGRESS') return 'IN_PROGRESS';
  if (raw === 'QUEUED') return 'QUEUED';
  if (raw === 'RUNNING') return 'RUNNING';
  if (raw === 'FAILED' || raw === 'ERROR') return 'FAILED';

  if (raw === 'COMPLETED' || raw === 'SUCCESS' || raw === 'PASSED') {
    return result.ok === false ? 'FAILED' : 'COMPLETED';
  }

  return result.ok === false ? 'FAILED' : 'COMPLETED';
}

function publish(eventName, payload = {}) {
  try {
    if (typeof eventBus.publish === 'function') return eventBus.publish(eventName, payload);
    if (typeof eventBus.emitEvent === 'function') return eventBus.emitEvent(eventName, payload);
    if (typeof eventBus.emit === 'function') return eventBus.emit(eventName, payload);
  } catch {}
  return null;
}

function eventFor(status) {
  if (status === 'COMPLETED') return 'TASK_COMPLETED';
  if (status === 'AWAITING_APPROVAL') return 'TASK_AWAITING_APPROVAL';
  if (status === 'BLOCKED') return 'TASK_BLOCKED';
  if (status === 'IN_PROGRESS' || status === 'QUEUED' || status === 'RUNNING') return 'TASK_IN_PROGRESS';
  return 'TASK_FAILED';
}

function logLabel(status) {
  if (status === 'AWAITING_APPROVAL') return 'Awaiting Approval';
  if (status === 'IN_PROGRESS' || status === 'QUEUED' || status === 'RUNNING') return 'In Progress';
  return status.charAt(0) + status.slice(1).toLowerCase();
}

if (!executionService[PATCH]) {
  executionService.executeConnectorTask = async function executeConnectorTaskWithSemanticTruth(task, provider, connectorName, action) {
    if (!connectorName || connectorName === 'UNKNOWN') {
      return this.handleFailure(task, new Error('EXECUTION_PLAN_INVALID: Missing connector'), provider, action);
    }

    const connector = connectorManager.get(connectorName);
    if (!connector) {
      return this.handleFailure(task, new Error(`Connector not found: ${connectorName}`), provider, action);
    }
    if (typeof connector.execute !== 'function') {
      return this.handleFailure(task, new Error(`Connector missing execute(): ${connectorName}`), provider, action);
    }

    try {
      taskQueue.update(task.id, { status: 'RUNNING', provider, connector: connectorName, action });
      publish('TASK_STARTED', { task, provider, connector: connectorName, action });
      log('ExecutionService', action, 'Running', connectorName);

      const result = await connector.execute(task);
      const finalStatus = normalizeSemanticStatus(result || {});
      const completed = finalStatus === 'COMPLETED';
      const terminalFailure = finalStatus === 'FAILED';

      const normalizedResult = {
        ok: completed,
        status: finalStatus,
        provider,
        action,
        connector: connectorName,
        result,
        completedAt: completed ? new Date().toISOString() : null,
        observedAt: new Date().toISOString()
      };

      taskQueue.update(task.id, {
        status: finalStatus,
        provider,
        connector: connectorName,
        action,
        error: terminalFailure
          ? (result?.error || result?.message || 'Connector execution returned failure')
          : null,
        result: normalizedResult
      });

      memory.remember('execution:last_result', task.id, normalizedResult);
      publish(eventFor(finalStatus), {
        task,
        result: normalizedResult,
        provider,
        connector: connectorName,
        action
      });
      log('ExecutionService', action, logLabel(finalStatus), connectorName);

      return normalizedResult;
    } catch (error) {
      return this.handleFailure(task, error, provider, action);
    }
  };

  executionService[PATCH] = true;
}

module.exports = executionService;
module.exports.normalizeSemanticStatus = normalizeSemanticStatus;
